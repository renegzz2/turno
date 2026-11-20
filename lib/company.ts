import { weekdays } from "./schedules";

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const defaultWeekStart: Weekday = 0;
export type CompanySettings = {
  name: string; workweek_start: Weekday; logo_revision: string | null; settings_saved: boolean;
};
export type CompanyUpdate = { name: string; weekStart: Weekday } & (
  { logoChange: "keep" | "remove" } | { logoChange: "replace"; logo: string }
);

export const maxLogoSize = 512 * 1024;
export const validLogoRevision = (value: string) => /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);

export function isWeekday(value: number): value is Weekday {
  return Number.isInteger(value) && value >= 0 && value < weekdays.length;
}

export function workweekLabel(start: Weekday) {
  return `${weekdays[start]} a ${weekdays[(start + 6) % weekdays.length].toLocaleLowerCase("es-MX")}`;
}

export function companyLogoUrl(revision?: string | null, kiosk = false) {
  return revision ? `/marca?v=${revision}${kiosk ? "&checador=1" : ""}` : undefined;
}
