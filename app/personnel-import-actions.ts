"use server";

import { revalidatePath } from "next/cache";
import { actor, importPersonnel } from "@/lib/backend";
import { isDate, localDate } from "@/lib/periods";
import { parsePersonnelWorkbook } from "@/lib/personnel-workbook";
import type { Result } from "@/lib/models";

type ImportFeedback = Result & { issues?: string[]; remaining?: number };

export async function uploadPersonnel(_: ImportFeedback, form: FormData): Promise<ImportFeedback> {
  const account = await actor("admin");
  if (!account) return { ok: false, message: "Se requiere el rol de Administrador." };
  const from = form.get("from");
  const file = form.get("workbook");
  if (!isDate(from) || from < localDate(new Date(), account.timezone)) {
    return { ok: false, message: "Elige una fecha de vigencia desde hoy." };
  }
  if (!(file instanceof File) || !file.size) return { ok: false, message: "Selecciona un archivo de Excel." };
  const { rows, errors } = await parsePersonnelWorkbook(file);
  if (errors.length) return {
    ok: false, message: "Corrige el archivo y vuelve a cargarlo. Se valida el archivo completo antes de guardar.",
    issues: errors.slice(0, 12), remaining: Math.max(0, errors.length - 12),
  };
  try {
    const result = await importPersonnel(from, rows);
    if (!result.ok) {
      const reasons = {
        duplicate_employee: "El número de empleado se repite en el archivo.",
        invalid_employee: "Revisa el número, el nombre y la fecha de vigencia.",
        name_required: "Escribe el nombre completo para dar de alta este número de empleado.",
        invalid_schedule: "Revisa las horas y la tolerancia del horario.",
        invalid_pin: "El PIN debe tener exactamente seis dígitos o quedar vacío.",
      };
      const issue = result.rowNumber ? `Fila ${result.rowNumber}. ${reasons[result.code]}` : reasons[result.code];
      return { ok: false, message: "Corrige el archivo y vuelve a cargarlo.", issues: [issue] };
    }
    revalidatePath("/personal");
    revalidatePath("/asistencias");
    const created = result.created === 1 ? "1 alta nueva" : `${result.created} altas nuevas`;
    const existing = result.existing === 1 ? "1 trabajador existente" : `${result.existing} trabajadores existentes`;
    return { ok: true, message: `Carga guardada con ${created} y ${existing} en el lote.` };
  } catch {
    return { ok: false, message: "No se pudo confirmar la carga. Revisa la lista antes de volver a intentarlo." };
  }
}
