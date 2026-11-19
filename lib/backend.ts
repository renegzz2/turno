import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { cache } from "react";
import { isOperationsRole, type Actor, type DirectoryEmployee, type Incident, type Kiosk, type NewEmployee, type NewIncident, type Punch, type Shift } from "./models";
import { addDays, localDate } from "./periods";
import { detectExceptions, type Entry, type Plan, type Schedule } from "./schedules";
import type { AdjustmentInput, AdjustmentResult, EditableShift, ShiftAdjustment } from "./adjustments";
import type { BatchEmployee, ImportResult } from "./personnel-import";
import type { QrChannel, QrContact } from "./qr";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_PUBLISHABLE_KEY;
const kioskToken = process.env.TURNO_KIOSK_TOKEN;
export const demo = process.env.NODE_ENV === "development" && !url && !key;
export const demoSessionCookie = "turno-demo-session";
const sampleBackend = process.env.NODE_ENV === "development" ? () => import("./demo") : null;
export const demoAccounts = process.env.NODE_ENV === "development" ? () => import("./demo-accounts") : null;

export const supabase = cache(async () => {
  if (!url || !key) return null;
  const store = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(items) {
        try {
          for (const { name, value, options } of items) store.set(name, value, options);
        } catch {
          // La lectura en componentes no modifica cookies. El proxy actualiza la sesión.
        }
      },
    },
  });
});

export async function clearPanelSession() {
  if (!url || !key) return;
  try {
    const client = await supabase();
    await client?.auth.signOut({ scope: "local" });
  } catch {
    // The browser session can still be cleared if the provider is unreachable.
  }
  const jar = await cookies();
  const authCookie = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  for (const { name } of jar.getAll()) {
    if (name === authCookie || (name.startsWith(`${authCookie}.`) && /^\d+$/.test(name.slice(authCookie.length + 1)))) jar.delete(name);
  }
}

export const currentAccount = cache(async (): Promise<Actor | null> => {
  if (demo && demoAccounts) {
    const token = (await cookies()).get(demoSessionCookie)?.value;
    return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? (await demoAccounts()).demoAccount(token) : null;
  }
  const client = await supabase();
  if (!client) return null;
  const { data, error } = await client.rpc("attendance_current_user").maybeSingle<Actor>();
  return error ? null : data;
});

export async function actor(access: "admin" | "operations"): Promise<Actor | null> {
  const account = await currentAccount();
  const allowed = access === "operations" ? isOperationsRole(account?.role) : account?.role === access;
  return allowed ? account : null;
}

export async function employees(): Promise<DirectoryEmployee[]> {
  if (demo && sampleBackend) return (await sampleBackend()).demoEmployees();
  const client = (await supabase())!;
  return collect<DirectoryEmployee>((from, to) => client.rpc("attendance_employee_directory").order("name").order("id").range(from, to));
}

export async function importPersonnel(from: string, rows: BatchEmployee[]): Promise<ImportResult> {
  if (demo && sampleBackend) return (await sampleBackend()).demoImportPersonnel(from, rows);
  const client = (await supabase())!;
  const { data, error } = await client.rpc("attendance_apply_personnel_import", { p_from: from, p_rows: rows });
  if (!error && Number.isInteger(data?.created) && Number.isInteger(data?.existing)) {
    return { ok: true, created: data.created, existing: data.existing };
  }
  if (error?.message === "duplicate_employee" || error?.message === "invalid_employee" || error?.message === "name_required"
    || error?.message === "invalid_schedule" || error?.message === "invalid_pin") {
    const number = Number(error.details);
    return { ok: false, code: error.message, rowNumber: Number.isInteger(number) && number > 1 ? number : undefined };
  }
  throw error ?? new Error("Unexpected personnel import response");
}

export async function addEmployee(input: NewEmployee) {
  if (demo && sampleBackend) return (await sampleBackend()).demoAdd(input);
  const client = (await supabase())!;
  const { data, error } = await client.rpc("attendance_add_employee", {
    p_code: input.code, p_name: input.name, p_pin: input.pin,
  });
  if (error) throw error;
  return data as string;
}

const demoKiosk: Kiosk = { name: "Modo demostración", timezone: "America/Mexico_City" };

function kioskClient() {
  if (!url || !key || !kioskToken || !/^[a-f0-9]{64}$/.test(kioskToken)) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function publicKiosk(): Promise<Kiosk | null> {
  if (demo) return demoKiosk;
  const client = kioskClient();
  if (!client) return null;
  const { data, error } = await client.rpc("attendance_public_kiosk", { p_token: kioskToken }).maybeSingle<Kiosk>();
  return error ? null : data;
}

export async function punch(input: Punch): Promise<{ status: string; name?: string; marked_at?: string; timezone?: string }> {
  if (demo && sampleBackend) {
    if (input.qr) return { status: "qr_invalid" };
    return { ...((await sampleBackend()).demoPunch(input)), timezone: demoKiosk.timezone };
  }
  const client = kioskClient();
  if (!client) return { status: "unavailable" };
  const { data, error } = await client.rpc("attendance_public_punch_qr", {
    p_token: kioskToken, p_code: input.code, p_pin: input.pin, p_direction: input.direction, p_request: input.requestId, p_qr: input.qr ?? null,
  });
  if (error) throw error;
  return data as { status: string; name?: string; marked_at?: string; timezone?: string };
}

export async function qrContact(employeeId: string): Promise<QrContact | null> {
  if (demo) return null;
  const client = (await supabase())!;
  const { data, error } = await client.rpc("attendance_qr_contact", { p_employee: employeeId }).maybeSingle<QrContact>();
  if (error) throw error;
  return data;
}

export async function persistQrContact(employeeId: string, channel: QrChannel | null, destination: string | null) {
  const client = (await supabase())!;
  const { data, error } = await client.rpc("attendance_save_qr_contact", {
    p_employee: employeeId, p_channel: channel, p_destination: destination,
  });
  if (error) throw error;
  return data === true;
}

export async function setEmployeeActive(id: string, active: boolean) {
  if (demo && sampleBackend) return (await sampleBackend()).demoSetEmployeeActive(id, active);
  const client = (await supabase())!;
  const { data, error } = await client.rpc("attendance_set_employee_active", { p_employee: id, p_active: active });
  if (error) throw error;
  return data as boolean;
}

export async function addIncident(id: string, input: NewIncident) {
  if (demo && sampleBackend) return (await sampleBackend()).demoAddIncident(id, input);
  const client = (await supabase())!;
  const { data, error } = await client.rpc("attendance_add_incident", {
    p_id: id, p_employee: input.employeeId, p_kind: input.kind, p_from: input.from, p_to: input.to,
  });
  if (error) throw error;
  return data as string;
}

export async function cancelIncident(id: string) {
  if (demo && sampleBackend) return (await sampleBackend()).demoCancelIncident(id);
  const client = (await supabase())!;
  const { data, error } = await client.rpc("attendance_cancel_incident", { p_id: id });
  if (error) throw error;
  return data as boolean;
}

export async function incidents(cut?: { from: string; to: string }): Promise<Incident[]> {
  if (demo && sampleBackend) return (await sampleBackend()).demoIncidents(cut);
  const client = (await supabase())!;
  return collect<Incident>((first, last) => client.rpc("attendance_incidents", {
    p_from: cut?.from ?? null, p_to: cut?.to ?? null,
  }).order("starts_on", { ascending: false }).order("id").range(first, last));
}

export async function report(from: string, to: string): Promise<Shift[]> {
  if (demo && sampleBackend) return (await sampleBackend()).demoReport(from, to);
  const client = (await supabase())!;
  return collect<Shift>((first, last) => client.rpc("attendance_report", { p_from: from, p_to: to })
    .order("entered_at", { ascending: false }).order("id").range(first, last));
}

export async function editableShift(id: string): Promise<EditableShift | null> {
  if (demo && sampleBackend) return (await sampleBackend()).demoEditableShift(id);
  const client = (await supabase())!;
  const { data, error } = await client.rpc("attendance_editable_shift", { p_shift: id }).maybeSingle<EditableShift>();
  if (error) throw error;
  return data;
}

export async function shiftAdjustments(id?: string): Promise<ShiftAdjustment[]> {
  if (demo && sampleBackend) return (await sampleBackend()).demoShiftAdjustments(id);
  const client = (await supabase())!;
  const query = () => client.rpc("attendance_shift_adjustments", { p_shift: id ?? null })
    .order("made_at", { ascending: false }).order("id");
  if (id) return collect<ShiftAdjustment>((first, last) => query().range(first, last));
  const { data, error } = await query().limit(30);
  if (error) throw error;
  return data as ShiftAdjustment[];
}

export async function adjustShift(input: AdjustmentInput): Promise<AdjustmentResult> {
  if (demo && sampleBackend) {
    const madeBy = (await currentAccount())?.email ?? "Cuenta de demostración";
    return (await sampleBackend()).demoAdjustShift(input, madeBy);
  }
  const client = (await supabase())!;
  const { data, error } = await client.rpc("attendance_adjust_shift", {
    p_request: input.requestId, p_employee: input.employeeId, p_shift: input.shiftId,
    p_expected_entry: input.expectedEntry, p_expected_exit: input.expectedExit,
    p_entry: input.entry, p_exit: input.exit, p_reason: input.reason,
  });
  if (error) throw error;
  return data as AdjustmentResult;
}

export async function plans(employeeId?: string): Promise<Plan[]> {
  if (demo && sampleBackend) return (await sampleBackend()).demoPlans(employeeId);
  const client = (await supabase())!;
  return collect<Plan>((from, to) => client.rpc("attendance_plans", { p_employee: employeeId ?? null })
    .order("id").range(from, to));
}

export async function saveSchedule(employeeId: string, schedule: Schedule) {
  if (demo && sampleBackend) return (await sampleBackend()).demoSaveSchedule(employeeId, schedule);
  const client = (await supabase())!;
  const { data, error } = await client.rpc("attendance_save_schedule", {
    p_employee: employeeId, p_from: schedule.starts_on, p_tolerance: schedule.tolerance, p_week: schedule.week,
  });
  if (error) throw error;
  return data as string;
}

export async function resetPin(employeeId: string, pin: string) {
  if (demo && sampleBackend) return (await sampleBackend()).demoResetPin(employeeId, pin);
  const client = (await supabase())!;
  const { data, error } = await client.rpc("attendance_reset_pin", { p_employee: employeeId, p_pin: pin });
  if (error) throw error;
  return data as boolean;
}

export async function justifyAbsence(employeeId: string, day: string) {
  if (demo && sampleBackend) return (await sampleBackend()).demoJustifyAbsence(employeeId, day);
  const client = (await supabase())!;
  const { data, error } = await client.rpc("attendance_justify_absence", { p_employee: employeeId, p_day: day });
  if (error) throw error;
  return data as string;
}

async function entries(from: string, to: string): Promise<Entry[]> {
  if (demo && sampleBackend) return (await sampleBackend()).demoEntries(from, to);
  const client = (await supabase())!;
  return collect<Entry>((first, last) => client.rpc("attendance_entries", { p_from: from, p_to: to })
    .order("entered_at").order("id").range(first, last));
}

export async function exceptionsForCut(cut: { from: string; to: string }, timezone: string, recorded: Incident[], employeeId?: string) {
  const now = new Date();
  const today = localDate(now, timezone);
  const end = cut.to < today ? cut.to : today;
  if (end < cut.from) return [];
  const assigned = (await plans(employeeId)).filter((plan) => plan.schedules.some((schedule) => schedule.starts_on <= end));
  if (!assigned.length) return [];
  const punches = await entries(cut.from, addDays(end, 1));
  return detectExceptions(cut, timezone, now, assigned, punches, recorded);
}

async function collect<T>(fetch: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>) {
  const size = 500;
  const rows: T[] = [];
  for (let start = 0; ; start += size) {
    const { data, error } = await fetch(start, start + size - 1);
    if (error) throw error;
    const page = data as T[];
    rows.push(...page);
    if (page.length < size) return rows;
  }
}
