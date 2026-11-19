"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actor, addEmployee, addIncident, adjustShift, cancelIncident, exceptionsForCut, incidents, justifyAbsence, punch, resetPin, saveSchedule, setEmployeeActive } from "@/lib/backend";
import { incidentNames, punchErrors, type IncidentKind, type Result } from "@/lib/models";
import { isDate, localDate, readCut, stamp } from "@/lib/periods";
import { localDateTime, readLocalDateTime } from "@/lib/adjustments";
import { isQrCode, normalizeQr } from "@/lib/qr";
import { validWeek, weekdays, type WorkHours } from "@/lib/schedules";

type PunchResult = Result & { nextRequest?: string };
type IncidentResult = Result & { nextRequest?: string };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export async function mark(previous: PunchResult, form: FormData): Promise<PunchResult> {
  const code = String(form.get("code") ?? "").trim();
  const pin = String(form.get("pin") ?? "");
  const direction = form.get("direction");
  const requestId = String(form.get("requestId") ?? "");
  const qr = normalizeQr(String(form.get("qr") ?? ""));
  if (!/^\d{1,12}$/.test(code) || !/^\d{6}$/.test(pin)
    || (direction !== "entrada" && direction !== "salida")
    || !uuid.test(requestId)) {
    return { ok: false, nextRequest: previous.nextRequest, message: "Escribe tu número de empleado y un PIN de seis dígitos." };
  }
  if (qr && !isQrCode(qr)) return { ok: false, nextRequest: requestId, message: punchErrors.qr_invalid };
  try {
    const response = await punch({ code, pin, direction, requestId, qr: qr || undefined });
    if (response.status !== "ok" || !response.marked_at || !response.timezone) {
      return { ok: false, nextRequest: requestId, message: punchErrors[response.status] ?? "No se pudo registrar la checada." };
    }
    const { time } = stamp(response.marked_at, response.timezone);
    revalidatePath("/asistencias");
    return { ok: true, nextRequest: randomUUID(), message: `${direction === "entrada" ? "Entrada registrada" : "Salida registrada"} a las ${time}. ${response.name}.` };
  } catch {
    return { ok: false, nextRequest: requestId, message: "No se pudo confirmar la checada. Intenta nuevamente." };
  }
}

export async function saveEmployee(_: Result, form: FormData): Promise<Result> {
  if (!(await actor("admin"))) return { ok: false, message: "Se requiere el rol de Administrador." };
  const code = String(form.get("code") ?? "").trim();
  const name = String(form.get("name") ?? "").trim();
  const pin = String(form.get("pin") ?? "");
  if (!/^\d{1,12}$/.test(code) || !name || name.length > 100 || !/^\d{6}$/.test(pin)) {
    return { ok: false, message: "Revisa el nombre, número de empleado y PIN de seis dígitos." };
  }
  try {
    const result = await addEmployee({ code, name, pin });
    if (result === "duplicate") return { ok: false, message: "Ya existe un trabajador con ese número." };
    if (result !== "ok") return { ok: false, message: "No se pudo guardar el trabajador." };
  } catch {
    return { ok: false, message: "No se pudo guardar el trabajador. Intenta nuevamente." };
  }
  revalidatePath("/personal");
  return { ok: true, message: "Trabajador registrado." };
}

export async function changeEmployeeStatus(_: Result, form: FormData): Promise<Result> {
  if (!(await actor("admin"))) return { ok: false, message: "Se requiere el rol de Administrador." };
  const id = String(form.get("employeeId") ?? "");
  const status = form.get("active");
  if (!uuid.test(id) || (status !== "true" && status !== "false")) {
    return { ok: false, message: "Selecciona un trabajador y un estado válidos." };
  }
  try {
    if (!(await setEmployeeActive(id, status === "true"))) return { ok: false, message: "No se encontró al trabajador." };
  } catch {
    return { ok: false, message: "No se pudo cambiar el estado. Intenta nuevamente." };
  }
  revalidatePath("/personal");
  revalidatePath("/asistencias");
  return { ok: true, message: status === "true" ? "Trabajador reactivado." : "Baja registrada." };
}

export async function saveIncident(_: IncidentResult, form: FormData): Promise<IncidentResult> {
  if (!(await actor("operations"))) return { ok: false, message: "Inicia sesión como Administrador o Líder." };
  const employeeId = String(form.get("employeeId") ?? "");
  const id = String(form.get("requestId") ?? "");
  const kind = String(form.get("kind") ?? "");
  const from = form.get("from");
  const to = form.get("to") || from;
  if (!uuid.test(employeeId) || !uuid.test(id) || !Object.hasOwn(incidentNames, kind)
    || !isDate(from) || !isDate(to) || from > to) {
    return { ok: false, nextRequest: uuid.test(id) ? id : undefined, message: "Revisa el trabajador, tipo y fechas de la incidencia." };
  }
  try {
    const result = await addIncident(id, { employeeId, kind: kind as IncidentKind, from, to });
    if (result === "overlap") return { ok: false, nextRequest: id, message: "El trabajador ya tiene una incidencia en una o más de esas fechas." };
    if (result !== "ok") return { ok: false, nextRequest: id, message: "No se pudo registrar la incidencia." };
  } catch {
    return { ok: false, nextRequest: id, message: "No se pudo confirmar el registro. Intenta nuevamente." };
  }
  revalidatePath("/personal");
  revalidatePath("/asistencias");
  return { ok: true, nextRequest: randomUUID(), message: "Incidencia registrada." };
}

export async function voidIncident(_: Result, form: FormData): Promise<Result> {
  if (!(await actor("admin"))) return { ok: false, message: "Se requiere el rol de Administrador." };
  const id = String(form.get("incidentId") ?? "");
  if (!uuid.test(id)) return { ok: false, message: "Selecciona una incidencia válida." };
  try {
    if (!(await cancelIncident(id))) return { ok: false, message: "No se encontró la incidencia." };
  } catch {
    return { ok: false, message: "No se pudo anular la incidencia. Intenta nuevamente." };
  }
  revalidatePath("/personal");
  revalidatePath("/asistencias");
  return { ok: true, message: "Incidencia anulada." };
}

export async function updateSchedule(_: Result, form: FormData): Promise<Result> {
  const account = await actor("operations");
  if (!account) return { ok: false, message: "Inicia sesión como Administrador o Líder." };
  const employee = String(form.get("employeeId") ?? "");
  const from = form.get("from");
  const rawTolerance = String(form.get("tolerance") ?? "");
  const tolerance = Number(rawTolerance);
  const week = weekdays.map((_, index): WorkHours | null => form.get(`work-${index}`) === "on"
    ? [String(form.get(`start-${index}`) ?? ""), String(form.get(`end-${index}`) ?? "")] : null);
  if (!uuid.test(employee) || !isDate(from) || from < localDate(new Date(), account.timezone)
    || !/^\d{1,4}$/.test(rawTolerance) || tolerance > 1439) {
    return { ok: false, message: "Elige una fecha de vigencia desde hoy y una tolerancia válida en minutos." };
  }
  if (!validWeek(week)) return { ok: false, message: "Revisa las horas de entrada y salida y evita que dos turnos se traslapen." };
  try {
    if (await saveSchedule(employee, { starts_on: from, tolerance, week }) !== "ok") {
      return { ok: false, message: "No se pudo guardar el horario. Revisa la fecha y las horas." };
    }
  } catch {
    return { ok: false, message: "No se pudo guardar el horario. Intenta nuevamente." };
  }
  revalidatePath(`/personal/${employee}`);
  revalidatePath("/asistencias");
  return { ok: true, message: "Horario guardado." };
}

export async function updatePin(_: Result, form: FormData): Promise<Result> {
  if (!(await actor("admin"))) return { ok: false, message: "Se requiere el rol de Administrador." };
  const employee = String(form.get("employeeId") ?? "");
  const pin = String(form.get("pin") ?? "");
  if (!uuid.test(employee) || !/^\d{6}$/.test(pin) || pin !== form.get("confirmPin")) {
    return { ok: false, message: "Escribe el mismo PIN de seis dígitos en ambos campos." };
  }
  try {
    if (!(await resetPin(employee, pin))) return { ok: false, message: "No se encontró al trabajador." };
  } catch {
    return { ok: false, message: "No se pudo restablecer el PIN. Intenta nuevamente." };
  }
  return { ok: true, message: "PIN restablecido. El nuevo PIN ya funciona en el checador." };
}

export async function justifyDetectedAbsence(_: Result, form: FormData): Promise<Result> {
  const account = await actor("operations");
  if (!account) return { ok: false, message: "Inicia sesión como Administrador o Líder." };
  const employee = String(form.get("employeeId") ?? "");
  const day = form.get("day");
  if (!uuid.test(employee) || !isDate(day)) return { ok: false, message: "Selecciona una falta válida." };
  const cut = { from: day, to: day };
  try {
    const records = await incidents(cut);
    const [exception] = await exceptionsForCut(cut, account.timezone, records, employee);
    if (!exception || exception.kind === "late") return { ok: false, message: "Esa fecha ya no tiene una falta que justificar." };
    if (await justifyAbsence(employee, day) !== "ok") {
      return { ok: false, message: "Ya existe otra incidencia en esa fecha." };
    }
  } catch {
    return { ok: false, message: "No se pudo justificar la falta. Intenta nuevamente." };
  }
  revalidatePath("/personal");
  revalidatePath("/asistencias");
  return { ok: true, message: "Falta justificada." };
}

const adjustmentErrors: Record<string, string> = {
  invalid: "No se encontró una jornada o un trabajador válido.",
  stale: "La jornada cambió desde que la abriste. Recarga la página y revisa las horas antes de volver a guardar.",
  times: "La salida debe ser posterior a la entrada y las horas deben haber ocurrido.",
  unchanged: "Las horas coinciden con las vigentes. Cambia la entrada o la salida para guardar el ajuste.",
  overlap: "Las horas coinciden con otra jornada del trabajador. Revisa si ya tiene una entrada abierta o un registro para ese horario.",
};

export async function saveShiftAdjustment(_: Result, form: FormData): Promise<Result> {
  const account = await actor("operations");
  if (!account) return { ok: false, message: "Inicia sesión como Administrador o Líder." };
  const field = (name: string) => String(form.get(name) ?? "");
  const employeeId = field("employeeId");
  const requestId = field("requestId");
  const shiftId = field("shiftId") || null;
  const expectedEntry = shiftId ? field("expectedEntry") : null;
  const expectedExit = shiftId ? field("expectedExit") || null : null;
  const reason = field("reason").trim();
  if (!uuid.test(employeeId) || !uuid.test(requestId) || (shiftId && !uuid.test(shiftId)) || !reason || reason.length > 500
    || (shiftId && !Number.isFinite(Date.parse(expectedEntry!))) || (expectedExit && !Number.isFinite(Date.parse(expectedExit)))) {
    return { ok: false, message: "Selecciona al trabajador y escribe el motivo del ajuste." };
  }
  const changedTime = (value: string, previous: string | null) => {
    const normalized = value.length === 16 ? `${value}:00` : value;
    return previous && normalized === localDateTime(previous, account.timezone) ? "" : value;
  };
  const entryValue = changedTime(field("entry"), expectedEntry);
  const exitValue = changedTime(field("exit"), expectedExit);
  const entry = entryValue ? readLocalDateTime(entryValue, account.timezone) : null;
  const exit = exitValue ? readLocalDateTime(exitValue, account.timezone) : null;
  if ((entryValue && !entry) || (exitValue && !exit)) {
    return { ok: false, message: "Revisa las fechas y horas. Elige una hora que exista y sea única en la zona horaria de la empresa." };
  }
  if ((!shiftId && !entry) || (!entry && !exit)) {
    return { ok: false, message: shiftId ? "Selecciona al menos una checada para corregir." : "Ingresa la fecha y hora de entrada." };
  }
  let savedId: string;
  try {
    const result = await adjustShift({ employeeId, requestId, shiftId, expectedEntry, expectedExit, entry, exit, reason });
    if (result.status !== "ok" || !result.shift_id) {
      return { ok: false, message: adjustmentErrors[result.status] ?? "No se pudo guardar el ajuste." };
    }
    savedId = result.shift_id;
  } catch {
    return { ok: false, message: "No se pudo confirmar el ajuste. Intenta nuevamente." };
  }
  revalidatePath("/asistencias");
  revalidatePath("/asistencias/ajustes");
  revalidatePath(`/asistencias/ajustes/${savedId}`);
  const params = new URLSearchParams({ guardado: requestId });
  if (field("from") && field("to")) {
    const cut = readCut({ from: field("from"), to: field("to"), period: field("period") }, localDate(new Date(), account.timezone));
    if (cut) for (const [key, value] of Object.entries(cut)) params.set(key, value);
  }
  redirect(`/asistencias/ajustes/${savedId}?${params}`);
}

