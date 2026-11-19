import ExcelJS from "exceljs";
import { actor, exceptionsForCut, incidents, report } from "@/lib/backend";
import { incidentNames } from "@/lib/models";
import { localDate, periodNames, readCut, stamp } from "@/lib/periods";
import { exceptionNames } from "@/lib/schedules";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function excelDate(value: string, timeZone: string) {
  const { date, time } = stamp(value, timeZone);
  const seconds = String(new Date(value).getUTCSeconds()).padStart(2, "0");
  return new Date(`${date}T${time}:${seconds}Z`);
}

function formatTable(sheet: ExcelJS.Worksheet, range: string) {
  sheet.autoFilter = range;
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4836A8" } };
}

export async function GET(request: Request) {
  const account = await actor("operations");
  if (!account) return new Response("Inicia sesión como Administrador o Líder.", { status: 401 });
  const cut = readCut(Object.fromEntries(new URL(request.url).searchParams), localDate(new Date(), account.timezone));
  if (!cut) return new Response("Elige fechas válidas.", { status: 400 });
  const [rows, recorded] = await Promise.all([report(cut.from, cut.to), incidents(cut)]);
  const exceptions = await exceptionsForCut(cut, account.timezone, recorded);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Turno";
  const summary = workbook.addWorksheet("Corte");
  summary.columns = [{ width: 24 }, { width: 36 }];
  summary.addRows([
    ["Empresa", account.name], ["Tipo de corte", periodNames[cut.period]], ["Inicio", cut.from],
    ["Fin", cut.to], ["Zona horaria", account.timezone], ["Jornadas", rows.length], ["Incidencias", recorded.length],
    ["Retardos", exceptions.filter((row) => row.kind === "late").length],
    ["Faltas pendientes", exceptions.filter((row) => row.kind === "absent").length],
  ]);
  summary.getColumn(1).font = { bold: true };

  const sheets = workbook.addWorksheet("Asistencias", { views: [{ state: "frozen", ySplit: 1 }] });
  sheets.columns = [
    { header: "Número de empleado", width: 24 }, { header: "Trabajador", width: 32 },
    { header: "Entrada", width: 23, style: { numFmt: "dd/mm/yyyy hh:mm:ss" } },
    { header: "Salida", width: 23, style: { numFmt: "dd/mm/yyyy hh:mm:ss" } },
    { header: "Horas del corte", width: 20, style: { numFmt: "[h]:mm" } },
    { header: "Estado", width: 17 },
  ];
  formatTable(sheets, "A1:F1");
  for (const row of rows) {
    sheets.addRow([
      row.code, row.name, excelDate(row.entered_at, account.timezone),
      row.exited_at && excelDate(row.exited_at, account.timezone),
      row.minutes === null ? null : row.minutes / 1440,
      row.exited_at ? "Completa" : "Sin salida",
    ]);
  }
  const incidentSheet = workbook.addWorksheet("Incidencias", { views: [{ state: "frozen", ySplit: 1 }] });
  incidentSheet.columns = [
    { header: "Número de empleado", width: 24 }, { header: "Trabajador", width: 32 }, { header: "Tipo", width: 25 },
    { header: "Desde", width: 16, style: { numFmt: "dd/mm/yyyy" } },
    { header: "Hasta", width: 16, style: { numFmt: "dd/mm/yyyy" } },
  ];
  formatTable(incidentSheet, "A1:E1");
  for (const row of recorded) {
    incidentSheet.addRow([row.code, row.name, incidentNames[row.kind],
      new Date(`${row.starts_on}T00:00:00Z`), new Date(`${row.ends_on}T00:00:00Z`)]);
  }
  const exceptionSheet = workbook.addWorksheet("Retardos y faltas", { views: [{ state: "frozen", ySplit: 1 }] });
  exceptionSheet.columns = [
    { header: "Número de empleado", width: 24 }, { header: "Trabajador", width: 32 },
    { header: "Día del turno", width: 16, style: { numFmt: "dd/mm/yyyy" } },
    { header: "Entrada prevista", width: 19 }, { header: "Primera entrada", width: 19 },
    { header: "Minutos de retardo", width: 22 }, { header: "Resultado", width: 23 },
  ];
  formatTable(exceptionSheet, "A1:G1");
  for (const row of exceptions) {
    exceptionSheet.addRow([row.code, row.name, new Date(`${row.day}T00:00:00Z`),
      row.expected, row.actual, row.minutes, exceptionNames[row.kind]]);
  }
  const file = await workbook.xlsx.writeBuffer();
  return new Response(new Uint8Array(file), { headers: {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="asistencias_${cut.from}_${cut.to}.xlsx"`,
    "Cache-Control": "private, no-store",
  } });
}
