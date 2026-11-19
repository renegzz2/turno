import { mkdirSync } from "node:fs";
import { randomUUID, scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { cwd } from "node:process";
import type { DirectoryEmployee, Employee, Incident, NewEmployee, NewIncident, Punch, Shift } from "./models";
import type { BatchEmployee, ImportResult } from "./personnel-import";
import type { Entry, Plan, Schedule } from "./schedules";
import type { AdjustmentInput, AdjustmentResult, EditableShift, ShiftAdjustment } from "./adjustments";
import { addDays, localDate } from "./periods";

const demoZone = "America/Mexico_City";

function hash(pin: string, salt: string) {
  return scryptSync(pin, salt, 32).toString("hex");
}

function database() {
  const folder = join(cwd(), ".demo");
  mkdirSync(folder, { recursive: true });
  const db = new DatabaseSync(join(folder, "attendance.sqlite"), { timeout: 5000 });
  db.exec(`
    CREATE TABLE IF NOT EXISTS employees (
      id TEXT PRIMARY KEY, code TEXT UNIQUE, name TEXT, active INTEGER, salt TEXT, hash TEXT
    );
    CREATE TABLE IF NOT EXISTS shifts (
      id TEXT PRIMARY KEY, employee TEXT REFERENCES employees(id), entered_at TEXT, exited_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_open ON shifts(employee) WHERE exited_at IS NULL;
    CREATE TABLE IF NOT EXISTS shift_adjustments (
      id TEXT PRIMARY KEY, shift_id TEXT NOT NULL REFERENCES shifts(id), made_at TEXT NOT NULL,
      made_by TEXT NOT NULL, reason TEXT NOT NULL, before_entry TEXT, before_exit TEXT,
      after_entry TEXT NOT NULL, after_exit TEXT
    );
    CREATE INDEX IF NOT EXISTS shift_adjustments_history ON shift_adjustments(shift_id, made_at, id);
    CREATE TABLE IF NOT EXISTS receipts (
      request TEXT PRIMARY KEY, employee TEXT, direction TEXT, marked_at TEXT
    );
    CREATE TABLE IF NOT EXISTS limits (id INTEGER PRIMARY KEY, until INTEGER, failures INTEGER);
    CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY, employee TEXT NOT NULL REFERENCES employees(id),
      kind TEXT NOT NULL, starts_on TEXT NOT NULL, ends_on TEXT NOT NULL, cancelled_at TEXT
    );
    CREATE INDEX IF NOT EXISTS incidents_employee_dates ON incidents(employee, starts_on, ends_on);
    CREATE TABLE IF NOT EXISTS employee_status_days (
      employee TEXT REFERENCES employees(id), starts_on TEXT, active INTEGER, PRIMARY KEY(employee, starts_on)
    );
    CREATE TABLE IF NOT EXISTS employee_schedules (
      employee TEXT REFERENCES employees(id), starts_on TEXT, tolerance INTEGER, week TEXT, PRIMARY KEY(employee, starts_on)
    );
    CREATE TRIGGER IF NOT EXISTS record_hire AFTER INSERT ON employees BEGIN
      INSERT INTO employee_status_days VALUES (new.id, date('now', '-6 hours'), new.active);
    END;
    CREATE TRIGGER IF NOT EXISTS record_status AFTER UPDATE OF active ON employees WHEN old.active <> new.active BEGIN
      INSERT INTO employee_status_days VALUES (new.id, date('now', '-6 hours'), new.active)
      ON CONFLICT(employee, starts_on) DO UPDATE SET active = excluded.active;
    END;
  `);
  db.exec("BEGIN IMMEDIATE");
  try {
    if (!db.prepare("SELECT 1 FROM employees LIMIT 1").get()) {
      const sample = ["Mariana López", "Diego Ramírez", "Valeria Torres", "Jorge Mendoza", "Sofía Hernández", "Luis García"];
      const date = localDate(new Date(), demoZone);
      sample.forEach((name, index) => {
        const id = insertEmployee(db, { code: String(101 + index), name, pin: "123456" });
        if (index === 0) return;
        const entered = Date.parse(`${addDays(date, index < 4 ? -1 : 0)}T${index % 2 ? "08:00" : "09:15"}:00-06:00`);
        const now = Date.now();
        if (entered >= now) return;
        const exited = entered + 8 * 60 * 60 * 1000;
        db.prepare("INSERT INTO shifts VALUES (?, ?, ?, ?)").run(
          randomUUID(), id, new Date(entered).toISOString(),
          exited <= now && index !== 5 ? new Date(exited).toISOString() : null,
        );
      });
    }
    db.prepare(`INSERT INTO employee_status_days
      SELECT e.id, ?, e.active FROM employees e
      WHERE NOT EXISTS (SELECT 1 FROM employee_status_days d WHERE d.employee = e.id)`)
      .run(localDate(new Date(), demoZone));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    db.close();
    throw error;
  }
  return db;
}

function insertEmployee(db: DatabaseSync, input: Pick<NewEmployee, "code" | "name"> & { pin?: string }) {
  const id = randomUUID();
  const salt = input.pin ? randomBytes(16).toString("hex") : null;
  const digest = input.pin && salt ? hash(input.pin, salt) : null;
  db.prepare("INSERT INTO employees VALUES (?, ?, ?, 1, ?, ?)").run(id, input.code, input.name, salt, digest);
  return id;
}

export function demoEmployees(): DirectoryEmployee[] {
  using db = database();
  const query = db.prepare("SELECT id, code, name, active, hash IS NOT NULL AS pin_configured FROM employees ORDER BY name");
  return (query.all() as unknown as (Omit<Employee, "active"> & { active: number; pin_configured: number })[])
    .map((row) => ({ ...row, active: Boolean(row.active), pin_configured: Boolean(row.pin_configured) }));
}

export function demoImportPersonnel(from: string, rows: BatchEmployee[]): ImportResult {
  using db = database();
  db.exec("BEGIN IMMEDIATE");
  try {
    const employee = db.prepare("SELECT id FROM employees WHERE code = ?");
    const effectiveSchedule = db.prepare(`SELECT week, tolerance FROM employee_schedules
      WHERE employee = ? AND starts_on <= ? ORDER BY starts_on DESC LIMIT 1`);
    const seen = new Set<string>();
    let created = 0;
    for (const row of rows) {
      const current = employee.get(row.code);
      if (seen.has(row.code) || (!current && !row.name)) {
        db.exec("ROLLBACK");
        return { ok: false, code: seen.has(row.code) ? "duplicate_employee" : "name_required", rowNumber: row.rowNumber };
      }
      seen.add(row.code);
      const id = current ? String(current.id) : insertEmployee(db, row);
      if (!current) created++;
      if (!current || row.week !== undefined || row.tolerance !== undefined) {
        const schedule = effectiveSchedule.get(id, from);
        const previousWeek: Schedule["week"] = schedule ? JSON.parse(String(schedule.week)) : Array(7).fill(null);
        saveDemoSchedule(db, id, {
          starts_on: from,
          tolerance: row.tolerance ?? Number(schedule?.tolerance ?? 0),
          week: row.week ?? previousWeek,
        });
      }
      if (current && row.pin !== undefined) resetDemoPin(db, id, row.pin);
    }
    db.exec("COMMIT");
    return { ok: true, created, existing: rows.length - created };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function demoAdd(input: NewEmployee) {
  using db = database();
  try {
    insertEmployee(db, input);
    return "ok";
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed: employees.code")) return "duplicate";
    throw error;
  }
}

export function demoSetEmployeeActive(id: string, active: boolean) {
  using db = database();
  return db.prepare("UPDATE employees SET active = ? WHERE id = ?").run(Number(active), id).changes === 1;
}

export function demoAddIncident(id: string, input: NewIncident) {
  using db = database();
  const changes = db.prepare(`
    INSERT INTO incidents (id, employee, kind, starts_on, ends_on)
    SELECT ?, e.id, ?, ?, ? FROM employees e WHERE e.id = ?
    AND NOT EXISTS (
      SELECT 1 FROM incidents i WHERE i.employee = e.id AND i.cancelled_at IS NULL
      AND i.starts_on <= ? AND i.ends_on >= ?
    ) ON CONFLICT(id) DO NOTHING
  `).run(id, input.kind, input.from, input.to, input.employeeId, input.to, input.from).changes;
  if (changes === 1) return "ok";
  const existing = db.prepare("SELECT * FROM incidents WHERE id = ?").get(id);
  if (existing) {
    return existing.employee === input.employeeId && existing.kind === input.kind
      && existing.starts_on === input.from && existing.ends_on === input.to ? "ok" : "invalid";
  }
  return db.prepare("SELECT 1 FROM employees WHERE id = ?").get(input.employeeId) ? "overlap" : "invalid";
}

export function demoCancelIncident(id: string) {
  using db = database();
  return db.prepare("UPDATE incidents SET cancelled_at = COALESCE(cancelled_at, ?) WHERE id = ?")
    .run(new Date().toISOString(), id).changes === 1;
}

export function demoIncidents(cut?: { from: string; to: string }): Incident[] {
  using db = database();
  const query = db.prepare(`
    SELECT i.id, e.code, e.name, i.kind, i.starts_on, i.ends_on
    FROM incidents i JOIN employees e ON i.employee = e.id
    WHERE i.cancelled_at IS NULL AND (? IS NULL OR i.ends_on >= ?) AND (? IS NULL OR i.starts_on <= ?)
    ORDER BY i.starts_on DESC, i.id
  `);
  return query.all(cut?.from ?? null, cut?.from ?? null, cut?.to ?? null, cut?.to ?? null) as unknown as Incident[];
}

export function demoPlans(employeeId?: string): Plan[] {
  using db = database();
  const employees = db.prepare("SELECT id, code, name, active FROM employees WHERE ? IS NULL OR id = ? ORDER BY id")
    .all(employeeId ?? null, employeeId ?? null) as unknown as (Omit<Employee, "active"> & { active: number })[];
  const schedules = db.prepare("SELECT starts_on, tolerance, week FROM employee_schedules WHERE employee = ? ORDER BY starts_on DESC");
  const statuses = db.prepare("SELECT starts_on, active FROM employee_status_days WHERE employee = ? ORDER BY starts_on DESC");
  return employees.map((employee) => ({
    ...employee,
    active: Boolean(employee.active),
    schedules: schedules.all(employee.id).map((row) => ({
      starts_on: String(row.starts_on), tolerance: Number(row.tolerance), week: JSON.parse(String(row.week)) as Schedule["week"],
    })),
    statuses: statuses.all(employee.id).map((row) => ({ starts_on: String(row.starts_on), active: Boolean(row.active) })),
  }));
}

export function demoSaveSchedule(employeeId: string, schedule: Schedule) {
  using db = database();
  return saveDemoSchedule(db, employeeId, schedule);
}

function saveDemoSchedule(db: DatabaseSync, employeeId: string, schedule: Schedule) {
  const result = db.prepare(`INSERT INTO employee_schedules
    SELECT id, ?, ?, ? FROM employees WHERE id = ?
    ON CONFLICT(employee, starts_on) DO UPDATE SET tolerance = excluded.tolerance, week = excluded.week`)
    .run(schedule.starts_on, schedule.tolerance, JSON.stringify(schedule.week), employeeId);
  return result.changes === 1 ? "ok" : "invalid";
}

export function demoResetPin(employeeId: string, pin: string) {
  using db = database();
  return resetDemoPin(db, employeeId, pin);
}

function resetDemoPin(db: DatabaseSync, employeeId: string, pin: string) {
  const salt = randomBytes(16).toString("hex");
  return db.prepare("UPDATE employees SET salt = ?, hash = ? WHERE id = ?").run(salt, hash(pin, salt), employeeId).changes === 1;
}

export function demoEntries(from: string, to: string): Entry[] {
  using db = database();
  const start = new Date(`${from}T00:00:00-06:00`).toISOString();
  const end = new Date(`${addDays(to, 1)}T00:00:00-06:00`).toISOString();
  return db.prepare(`SELECT e.code, s.entered_at FROM shifts s JOIN employees e ON e.id = s.employee
    WHERE s.entered_at >= ? AND s.entered_at < ? ORDER BY s.entered_at, s.id`).all(start, end) as unknown as Entry[];
}

export function demoJustifyAbsence(employeeId: string, day: string) {
  using db = database();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = justifyAbsence(db, employeeId, day);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function justifyAbsence(db: DatabaseSync, employeeId: string, day: string) {
  if (!db.prepare("SELECT 1 FROM employees WHERE id = ?").get(employeeId)) return "invalid";
  const previous = db.prepare(`SELECT id, kind, starts_on, ends_on FROM incidents
    WHERE employee = ? AND cancelled_at IS NULL AND ? BETWEEN starts_on AND ends_on`).get(employeeId, day);
  const insert = db.prepare("INSERT INTO incidents (id, employee, kind, starts_on, ends_on) VALUES (?, ?, ?, ?, ?)");
  if (previous) {
    if (previous.kind === "justified") return "ok";
    if (previous.kind !== "unjustified") return "overlap";
    db.prepare("UPDATE incidents SET cancelled_at = ? WHERE id = ?").run(new Date().toISOString(), String(previous.id));
    const from = String(previous.starts_on);
    const to = String(previous.ends_on);
    if (from < day) insert.run(randomUUID(), employeeId, "unjustified", from, addDays(day, -1));
    if (to > day) insert.run(randomUUID(), employeeId, "unjustified", addDays(day, 1), to);
  }
  insert.run(randomUUID(), employeeId, "justified", day, day);
  return "ok";
}

export function demoReport(from: string, to: string) {
  using db = database();
  const statement = db.prepare(`SELECT s.id, e.code, e.name, s.entered_at, s.exited_at
    FROM shifts s JOIN employees e ON s.employee = e.id ORDER BY s.entered_at DESC, s.id`);
  const rows = statement.all() as unknown as Omit<Shift, "minutes">[];
  // La zona fija de la demostración no observa horario de verano en las fechas de los ejemplos.
  const start = Date.parse(`${from}T00:00:00-06:00`);
  const end = Date.parse(`${addDays(to, 1)}T00:00:00-06:00`);
  return rows.flatMap((row): Shift[] => {
    const entry = Date.parse(row.entered_at);
    const exit = row.exited_at ? Date.parse(row.exited_at) : null;
    if (entry >= end || (entry < start && (exit === null || exit <= start))) return [];
    return [{ ...row, minutes: exit === null ? null : Math.floor((Math.min(exit, end) - Math.max(entry, start)) / 60000) }];
  });
}

export function demoEditableShift(shiftId: string): EditableShift | null {
  using db = database();
  const shift = db.prepare(`SELECT s.id, e.id AS employee_id, e.code, e.name, s.entered_at, s.exited_at
    FROM shifts s JOIN employees e ON e.id = s.employee WHERE s.id = ?`).get(shiftId);
  return shift ? { ...shift } as EditableShift : null;
}

export function demoShiftAdjustments(shiftId?: string): ShiftAdjustment[] {
  using db = database();
  return db.prepare(`SELECT a.*, e.code, e.name FROM shift_adjustments a
    JOIN shifts s ON s.id = a.shift_id JOIN employees e ON e.id = s.employee
    WHERE ? IS NULL OR a.shift_id = ? ORDER BY a.made_at DESC, a.id
    LIMIT ?`).all(shiftId ?? null, shiftId ?? null, shiftId ? -1 : 30) as unknown as ShiftAdjustment[];
}

export function demoAdjustShift(input: AdjustmentInput, madeBy: string): AdjustmentResult {
  using db = database();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = adjustShift(db, input, madeBy);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function adjustShift(db: DatabaseSync, input: AdjustmentInput, madeBy: string): AdjustmentResult {
  if (!db.prepare("SELECT 1 FROM employees WHERE id = ?").get(input.employeeId)) return { status: "invalid" };
  const saved = db.prepare(`SELECT a.*, s.employee FROM shift_adjustments a
    JOIN shifts s ON s.id = a.shift_id WHERE a.id = ?`).get(input.requestId);
  if (saved) {
    const sameRequest = saved.employee === input.employeeId && saved.reason === input.reason && saved.made_by === madeBy
      && (input.shiftId ? saved.shift_id === input.shiftId : saved.before_entry === null)
      && saved.before_entry === input.expectedEntry && saved.before_exit === input.expectedExit
      && saved.after_entry === (input.entry ?? saved.before_entry) && saved.after_exit === (input.exit ?? saved.before_exit);
    return sameRequest ? { status: "ok", shift_id: String(saved.shift_id) } : { status: "stale" };
  }
  const previous = input.shiftId ? db.prepare(`SELECT entered_at, exited_at FROM shifts WHERE id = ? AND employee = ?`)
    .get(input.shiftId, input.employeeId) : null;
  if (input.shiftId && !previous) return { status: "invalid" };
  const oldEntry = previous?.entered_at as string | null | undefined ?? null;
  const oldExit = previous?.exited_at as string | null | undefined ?? null;
  if (input.shiftId && (oldEntry !== input.expectedEntry || oldExit !== input.expectedExit)) return { status: "stale" };
  const entry = input.entry ?? oldEntry;
  const exit = input.exit ?? oldExit;
  const now = new Date().toISOString();
  if (!entry || entry > now || (exit && (exit <= entry || exit > now))) return { status: "times" };
  if (entry === oldEntry && exit === oldExit) return { status: "unchanged" };
  const conflict = db.prepare(`SELECT 1 FROM shifts
    WHERE employee = ? AND id IS NOT ? AND (exited_at IS NULL OR exited_at > entered_at)
      AND (exited_at IS NULL OR exited_at > ?) AND (? IS NULL OR entered_at < ?) LIMIT 1`)
    .get(input.employeeId, input.shiftId, entry, exit, exit);
  if (conflict) return { status: "overlap" };
  const shiftId = input.shiftId ?? randomUUID();
  if (input.shiftId) {
    db.prepare("UPDATE shifts SET entered_at = ?, exited_at = ? WHERE id = ?").run(entry, exit, shiftId);
  } else {
    db.prepare("INSERT INTO shifts VALUES (?, ?, ?, ?)").run(shiftId, input.employeeId, entry, exit);
  }
  db.prepare("INSERT INTO shift_adjustments VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(input.requestId, shiftId, now, madeBy, input.reason, oldEntry, oldExit, entry, exit);
  return { status: "ok", shift_id: shiftId };
}

type Receipt = { status: string; name?: string; marked_at?: string };

export function demoPunch(input: Punch): Receipt {
  using db = database();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = recordPunch(db, input);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function recordPunch(db: DatabaseSync, input: Punch): Receipt {
  const now = Date.now();
  db.prepare(`INSERT INTO limits VALUES (1, ?, 0)
    ON CONFLICT(id) DO UPDATE SET until = excluded.until, failures = 0 WHERE limits.until <= ?`).run(now + 300000, now);
  if (Number(db.prepare("SELECT failures FROM limits WHERE id = 1").get()?.failures) >= 15) return { status: "locked" };
  const employee = db.prepare("SELECT id, name, active, hash, salt FROM employees WHERE code = ?")
    .get(input.code) as { id: string; name: string; active: number; hash: string | null; salt: string | null } | undefined;
  if (!employee?.hash || !employee.salt || !timingSafeEqual(Buffer.from(employee.hash, "hex"), Buffer.from(hash(input.pin, employee.salt), "hex"))) {
    db.exec("UPDATE limits SET failures = failures + 1 WHERE id = 1");
    return { status: "invalid" };
  }
  const receipt = db.prepare("SELECT * FROM receipts WHERE request = ?").get(input.requestId);
  if (receipt) {
    return receipt.employee === employee.id && receipt.direction === input.direction
      ? { status: "ok", name: employee.name, marked_at: String(receipt.marked_at) } : { status: "invalid" };
  }
  const open = db.prepare("SELECT id FROM shifts WHERE employee = ? AND exited_at IS NULL").get(employee.id);
  if (!employee.active && (input.direction === "entrada" || !open)) return { status: "inactive" };
  const marked = new Date().toISOString();
  if (input.direction === "entrada") {
    if (open) return { status: "already_open" };
    db.prepare("INSERT INTO shifts VALUES (?, ?, ?, NULL)").run(randomUUID(), employee.id, marked);
  } else {
    if (!open) return { status: "no_open" };
    db.prepare("UPDATE shifts SET exited_at = ? WHERE id = ?").run(marked, String(open.id));
  }
  db.prepare("INSERT INTO receipts VALUES (?, ?, ?, ?)").run(input.requestId, employee.id, input.direction, marked);
  return { status: "ok", name: employee.name, marked_at: marked };
}
