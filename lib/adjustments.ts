import { isDate } from "./periods";

export type EditableShift = {
  id: string; employee_id: string; code: string; name: string; entered_at: string; exited_at: string | null;
};

export type ShiftAdjustment = {
  id: string; shift_id: string; code: string; name: string; made_at: string; made_by: string; reason: string;
  before_entry: string | null; before_exit: string | null; after_entry: string; after_exit: string | null;
};

export type AdjustmentInput = {
  requestId: string; employeeId: string; shiftId: string | null;
  expectedEntry: string | null; expectedExit: string | null;
  entry: string | null; exit: string | null; reason: string;
};

export type AdjustmentResult = { status: string; shift_id?: string };

function localFormatter(timezone: string) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
}

export function localDateTime(timestamp: string, timezone: string) {
  return localFormatter(timezone).format(new Date(timestamp)).replace(" ", "T");
}

export function readLocalDateTime(value: string, timezone: string): string | null {
  const [day] = value.split("T");
  if (!isDate(day) || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)) return null;
  const normalized = value.length === 16 ? `${value}:00` : value;
  const wallTime = Date.parse(`${normalized}Z`);
  const formatter = localFormatter(timezone);
  const offsets = new Set<number>();
  // Sample both sides of a clock change so a skipped or repeated local hour is detected.
  for (const hours of [-36, -12, 0, 12, 36]) {
    const sample = wallTime + hours * 3_600_000;
    const displayed = formatter.format(new Date(sample)).replace(" ", "T");
    offsets.add(Date.parse(`${displayed}Z`) - sample);
  }
  const matches = [...offsets].map((offset) => new Date(wallTime - offset))
    .filter((instant) => formatter.format(instant).replace(" ", "T") === normalized);
  return matches.length === 1 ? matches[0].toISOString() : null;
}
