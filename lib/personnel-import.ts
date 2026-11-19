import type { Schedule } from "./schedules";

export const maxImportRows = 500;
export const maxImportBytes = 512 * 1024;

export type BatchEmployee = {
  rowNumber: number;
  code: string;
  name: string;
  pin?: string;
  tolerance?: number;
  week?: Schedule["week"];
};

export type ImportResult = { ok: true; created: number; existing: number }
  | { ok: false; code: "duplicate_employee" | "invalid_employee" | "name_required" | "invalid_schedule" | "invalid_pin"; rowNumber?: number };
