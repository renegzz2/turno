import "server-only";
import { createClient } from "@supabase/supabase-js";
import { demo, demoAccounts, supabase } from "./backend";
import type { PanelRole, PanelUser } from "./models";

export const canCreatePanelUsers = demo || Boolean(process.env.SUPABASE_SECRET_KEY);

export async function listPanelUsers(): Promise<PanelUser[]> {
  if (demo && demoAccounts) return (await demoAccounts()).demoListUsers();
  const client = (await supabase())!;
  const users: PanelUser[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client.rpc("attendance_panel_users").order("email").order("id").range(offset, offset + pageSize - 1);
    if (error) throw error;
    const page = data as PanelUser[];
    users.push(...page);
    if (page.length < pageSize) return users;
  }
}

export async function provisionPanelUser(email: string, password: string, role: PanelRole, creator: string) {
  if (demo && demoAccounts) return (await demoAccounts()).demoCreateUser(email, password, role, creator);
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) return "unconfigured";
  const client = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await client.auth.admin.createUser({
    email, password, email_confirm: true,
    app_metadata: { turno_provision: { by: creator, role } },
  });
  if (!error) return "ok";
  if (error.code === "email_exists" || error.code === "user_already_exists") return "duplicate";
  return error.code === "weak_password" ? "weak_password" : "failed";
}

export async function changePanelRole(id: string, role: PanelRole, creator: string) {
  if (demo && demoAccounts) return (await demoAccounts()).demoChangeRole(id, role, creator);
  const client = (await supabase())!;
  const { data, error } = await client.rpc("attendance_change_panel_role", { p_user: id, p_role: role });
  if (error) throw error;
  return data === true;
}
