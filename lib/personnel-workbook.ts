import "server-only";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { isTime, validWeek, weekdays, type WorkHours } from "./schedules";
import { maxImportBytes, maxImportRows, type BatchEmployee } from "./personnel-import";

const codeHeader = "Número de empleado";
const nameHeader = "Nombre completo";
const toleranceHeader = "Tolerancia (min)";
const pinHeader = "PIN";
const hourHeaders = weekdays.flatMap((day) => [`${day} entrada`, `${day} salida`]);
const requiredHeaders = [codeHeader, nameHeader, ...hourHeaders];
const headers = [...requiredHeaders, toleranceHeader, pinHeader];
const normalize = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().replace(/\s+/g, " ").toLowerCase();
const normalizedHeaders = new Map(headers.map((title) => [normalize(title), title]));
const maxArchiveBytes = 8 * 1024 * 1024;

type ParsedWorkbook = { rows: BatchEmployee[]; errors: string[] };

function isBlank(value: ExcelJS.CellValue) {
  return value === undefined || value === null || (typeof value === "string" && !value.trim());
}

function digitText(cell: ExcelJS.Cell) {
  if (typeof cell.value === "string") return cell.value.trim();
  if (typeof cell.value !== "number" || !Number.isSafeInteger(cell.value) || cell.value < 0) return "";
  const code = String(cell.value);
  return /^0{1,12}$/.test(cell.numFmt ?? "") ? code.padStart(cell.numFmt.length, "0") : code;
}

function workTime(value: ExcelJS.CellValue, date1904: boolean) {
  if (typeof value === "string") {
    const time = value.trim().replace(/^(\d):/, "0$1:");
    return isTime(time) ? time : null;
  }
  const dayStart = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const minutes = typeof value === "number" ? value * 1440
    : value instanceof Date ? (value.getTime() - dayStart) / 60000 : NaN;
  const rounded = Math.round(minutes);
  if (!Number.isFinite(minutes) || Math.abs(rounded - minutes) > 0.00001 || rounded < 0 || rounded > 1439) return null;
  return `${String(Math.floor(rounded / 60)).padStart(2, "0")}:${String(rounded % 60).padStart(2, "0")}`;
}

async function readWorkbook(file: File) {
  if (!file.size || file.size > maxImportBytes || !file.name.toLowerCase().endsWith(".xlsx")) return null;
  const data = await file.arrayBuffer();
  const archive = await JSZip.loadAsync(data);
  const files = Object.values(archive.files).filter((part) => !part.dir);
  if (files.length > 128) return null;
  let expanded = 0;
  for (const part of files) {
    await pipeline(part.nodeStream("nodebuffer"), new Writable({
      write(chunk: Buffer, _encoding, done) {
        expanded += chunk.byteLength;
        done(expanded > maxArchiveBytes ? new Error("Workbook exceeds expanded size limit") : undefined);
      },
    }));
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data);
  return workbook;
}

export async function parsePersonnelWorkbook(file: File): Promise<ParsedWorkbook> {
  let workbook: ExcelJS.Workbook | null;
  try {
    workbook = await readWorkbook(file);
  } catch {
    workbook = null;
  }
  if (!workbook) return { rows: [], errors: ["Elige un archivo .xlsx válido de hasta 512 KB. Usa la plantilla y conserva únicamente los datos de la carga."] };
  const sheet = workbook.getWorksheet("Personal") ?? workbook.worksheets[0];
  if (!sheet) return { rows: [], errors: ["El archivo debe contener una hoja con los datos de Personal."] };
  const columns = new Map<string, number>();
  const errors: string[] = [];
  sheet.getRow(1).eachCell((cell, index) => {
    if (typeof cell.value !== "string") return;
    const header = normalizedHeaders.get(normalize(cell.value));
    if (!header) return;
    if (columns.has(header)) errors.push(`Encabezado repetido: ${header}.`);
    columns.set(header, index);
  });
  const missing = requiredHeaders.filter((header) => !columns.has(header));
  if (missing.length) errors.push(`Faltan las columnas ${missing.join(", ")}.`);
  if (errors.length) return { rows: [], errors };

  const rows: BatchEmployee[] = [];
  const seen = new Map<string, number>();
  let filled = 0;
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1 || filled > maxImportRows) return;
    const cell = (header: string) => row.getCell(columns.get(header)!);
    const value = (header: string) => columns.has(header) ? cell(header).value : undefined;
    if (headers.every((header) => isBlank(value(header)))) return;
    filled++;
    if (filled > maxImportRows) return;
    const initialErrors = errors.length;
    const issue = (message: string) => errors.push(`Fila ${rowNumber}. ${message}`);
    const code = digitText(cell(codeHeader));
    const fullName = value(nameHeader);
    const name = typeof fullName === "string" ? fullName.trim() : "";
    if (!/^\d{1,12}$/.test(code)) issue("El número de empleado debe tener entre 1 y 12 dígitos.");
    else if (seen.has(code)) issue(`El número ${code} ya aparece en la fila ${seen.get(code)}.`);
    else seen.set(code, rowNumber);
    if (!isBlank(fullName) && (!name || name.length > 100)) issue("Escribe un nombre completo de hasta 100 caracteres.");
    const pin = isBlank(value(pinHeader)) ? undefined : digitText(cell(pinHeader));
    if (pin !== undefined && !/^\d{6}$/.test(pin)) issue("El PIN debe tener exactamente seis dígitos. También puedes dejarlo vacío.");

    const toleranceValue = value(toleranceHeader);
    const toleranceText = typeof toleranceValue === "string" ? toleranceValue.trim() : toleranceValue;
    const tolerance = isBlank(toleranceValue) ? undefined
      : typeof toleranceText === "number" || (typeof toleranceText === "string" && /^\d{1,4}$/.test(toleranceText))
        ? Number(toleranceText) : NaN;
    if (tolerance !== undefined && (!Number.isInteger(tolerance) || tolerance < 0 || tolerance > 1439)) {
      issue("La tolerancia debe ser un número entero de 0 a 1439 minutos.");
    }

    const week = weekdays.map((day): WorkHours | null => {
      const entry = value(`${day} entrada`);
      const exit = value(`${day} salida`);
      if (isBlank(entry) && isBlank(exit)) return null;
      const start = workTime(entry, Boolean(workbook.properties.date1904));
      const end = workTime(exit, Boolean(workbook.properties.date1904));
      if (start && end && start !== end) return [start, end];
      issue(`Para el ${day.toLowerCase()}, escribe una entrada y salida distintas en formato HH:mm o deja ambas celdas vacías si es descanso.`);
      return null;
    });
    if (!validWeek(week)) issue("Dos turnos se traslapan. Revisa la salida de los turnos nocturnos y la entrada del día siguiente.");
    if (errors.length === initialErrors) rows.push({ rowNumber, code, name, pin, tolerance, week: week.some(Boolean) ? week : undefined });
  });
  if (filled > maxImportRows) errors.unshift(`El archivo supera los ${maxImportRows} trabajadores por carga.`);
  if (!filled) errors.push("Agrega al menos un trabajador debajo de los encabezados.");
  return { rows, errors };
}
