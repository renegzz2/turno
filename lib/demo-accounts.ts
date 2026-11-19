import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "node:process";
import { DatabaseSync } from "node:sqlite";
import { demoEmails, demoPassword } from "./demo-credentials";
import type { Actor, PanelRole, PanelUser, Role } from "./models";

export const sessionHours = 8;
const sessionHash = (token: string) => createHash("sha256").update(token).digest("hex");

function database() {
  const folder = join(cwd(), ".demo");
  mkdirSync(folder, { recursive: true });
  const db = new DatabaseSync(join(folder, "usuarios.sqlite"), { timeout: 5000 });
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, role TEXT NOT NULL CHECK (role IN ('admin','leader','kiosk')),
      salt TEXT NOT NULL, password_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES accounts(id), expires INTEGER NOT NULL
    );
  `);
  return db;
}

function insert(db: DatabaseSync, email: string, password: string, role: Role) {
  const salt = randomBytes(16).toString("hex");
  return db.prepare(`INSERT INTO accounts VALUES (?, ?, ?, ?, ?) ON CONFLICT(email) DO NOTHING`)
    .run(randomUUID(), email, role, salt, scryptSync(password, salt, 32).toString("hex")).changes === 1;
}

export function demoSignIn(email: string, password: string) {
  using db = database();
  for (const [role, address] of Object.entries(demoEmails)) {
    if (!db.prepare("SELECT 1 FROM accounts WHERE email = ?").get(address)) {
      insert(db, address, demoPassword, role as Role);
    }
  }
  const row = db.prepare("SELECT id, role, salt, password_hash FROM accounts WHERE email = ?").get(email);
  if (!row || !timingSafeEqual(scryptSync(password, String(row.salt), 32), Buffer.from(String(row.password_hash), "hex"))) return null;
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  db.prepare("DELETE FROM sessions WHERE expires <= ?").run(now);
  db.prepare("INSERT INTO sessions VALUES (?, ?, ?)").run(sessionHash(token), row.id!, now + sessionHours * 3600000);
  return { token, role: row.role as Role };
}

export function demoAccount(token: string): Actor | null {
  using db = database();
  const row = db.prepare(`SELECT a.id, a.email, a.role FROM sessions s JOIN accounts a ON a.id = s.user_id
    WHERE s.token_hash = ? AND s.expires > ?`).get(sessionHash(token), Date.now());
  return row ? { ...(row as Pick<Actor, "id" | "email" | "role">), name: "Sucursal Centro (demo)", timezone: "America/Mexico_City" } : null;
}

export function demoSignOut(token: string) {
  using db = database();
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sessionHash(token));
}

export function demoListUsers(): PanelUser[] {
  using db = database();
  return db.prepare("SELECT id, email, role FROM accounts WHERE role IN ('admin','leader') ORDER BY email").all() as unknown as PanelUser[];
}

export function demoCreateUser(email: string, password: string, role: PanelRole, creator: string) {
  using db = database();
  db.exec("BEGIN IMMEDIATE");
  try {
    const admin = db.prepare("SELECT 1 FROM accounts WHERE id = ? AND role = 'admin'").get(creator);
    const result = admin ? (insert(db, email, password, role) ? "ok" : "duplicate") : "denied";
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function demoChangeRole(id: string, role: PanelRole, creator: string) {
  using db = database();
  return db.prepare(`UPDATE accounts SET role = ? WHERE id = ? AND id <> ? AND role IN ('admin','leader')
    AND EXISTS (SELECT 1 FROM accounts WHERE id = ? AND role = 'admin')`).run(role, id, creator, creator).changes === 1;
}
