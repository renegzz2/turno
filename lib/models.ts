export type PanelRole = "admin" | "leader";
export type Role = PanelRole | "kiosk";
export type Actor = { id: string; email: string | null; name: string; timezone: string; role: Role };
export type Kiosk = Pick<Actor, "name" | "timezone"> & { logo_revision?: string | null };
export type PanelUser = { id: string; email: string; role: PanelRole };
export const roleNames: Record<Role, string> = { admin: "Administrador", leader: "Líder", kiosk: "Checador" };

export function isOperationsRole(role: unknown): role is PanelRole {
  return role === "admin" || role === "leader";
}
export type Employee = { id: string; code: string; name: string; active: boolean };
export type DirectoryEmployee = Employee & { pin_configured: boolean };
export type NewEmployee = { code: string; name: string; pin: string };
export const incidentNames = {
  justified: "Falta justificada",
  unjustified: "Falta injustificada",
  sick_leave: "Incapacidad",
  vacation: "Vacaciones",
} as const;
export type IncidentKind = keyof typeof incidentNames;
export type NewIncident = {
  employeeId: string;
  kind: IncidentKind;
  from: string;
  to: string;
};
export type Incident = {
  id: string;
  code: string;
  name: string;
  kind: IncidentKind;
  starts_on: string;
  ends_on: string;
};
export type Shift = {
  id: string;
  code: string;
  name: string;
  entered_at: string;
  exited_at: string | null;
  minutes: number | null;
};
export type Direction = "entrada" | "salida";
export type Punch = { code: string; pin: string; direction: Direction; requestId: string; qr?: string };
export type Result = { ok: boolean; message: string };

export const punchErrors: Record<string, string> = {
  invalid: "Revisa tu número de empleado y tu PIN.",
  locked: "Hay demasiados intentos. Espera unos minutos y vuelve a intentar.",
  already_open: "Ya tienes una entrada abierta. Registra tu salida.",
  no_open: "No hay una entrada abierta para registrar esta salida.",
  inactive: "Tu registro de personal está de baja. Consulta a tu encargado.",
  unavailable: "El checador aún no está habilitado. Consulta a tu encargado.",
  qr_required: "Escanea o escribe el QR de este turno y vuelve a ingresar tu PIN.",
  qr_invalid: "El QR no corresponde a esta checada. Usa el más reciente para la entrada o el de tu entrada para la salida.",
};
