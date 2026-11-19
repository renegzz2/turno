"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect, RedirectType } from "next/navigation";
import { actor, clearPanelSession, demo, demoAccounts, demoSessionCookie, supabase } from "@/lib/backend";
import { isOperationsRole, type Actor, type Result } from "@/lib/models";
import { changePanelRole, provisionPanelUser } from "@/lib/panel-users";

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const validEmail = (value: string) => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const badLogin: Result = { ok: false, message: "No se pudo iniciar sesión. Revisa tu correo y contraseña." };

export async function signIn(_: Result, form: FormData): Promise<Result> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const wrongRole = { ok: false, message: "El panel requiere una cuenta de Administrador o Líder." };
  if (!validEmail(email) || !password || password.length > 1024) return badLogin;

  if (demo && demoAccounts) {
    const local = await demoAccounts();
    const session = local.demoSignIn(email, password);
    if (!session) return badLogin;
    if (!isOperationsRole(session.role)) {
      local.demoSignOut(session.token);
      return wrongRole;
    }
    const jar = await cookies();
    const previous = jar.get(demoSessionCookie)?.value;
    if (previous) local.demoSignOut(previous);
    jar.set(demoSessionCookie, session.token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: local.sessionHours * 3600 });
  } else {
    const client = await supabase();
    if (!client) return { ok: false, message: "Configura la conexión de Supabase para iniciar sesión." };
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) return badLogin;
    const { data } = await client.rpc("attendance_current_user").maybeSingle<Actor>();
    if (!isOperationsRole(data?.role)) {
      await clearPanelSession();
      return wrongRole;
    }
  }
  redirect("/asistencias", RedirectType.replace);
}

export async function signOut() {
  if (demo && demoAccounts) {
    const jar = await cookies();
    const token = jar.get(demoSessionCookie)?.value;
    if (token) (await demoAccounts()).demoSignOut(token);
    jar.delete(demoSessionCookie);
  } else {
    await clearPanelSession();
  }
  revalidatePath("/asistencias");
  redirect("/", RedirectType.replace);
}

export async function createPanelUser(_: Result, form: FormData): Promise<Result> {
  const account = await actor("admin");
  if (!account) return { ok: false, message: "Se requiere el rol de Administrador." };
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const role = form.get("role");
  if (!validEmail(email) || !isOperationsRole(role)) return { ok: false, message: "Ingresa un correo válido y elige un rol." };
  if (password.length < 12 || Buffer.byteLength(password) > 72 || password !== form.get("confirmation")) {
    return { ok: false, message: "Usa una contraseña de al menos 12 caracteres y confirma que ambos campos coincidan." };
  }
  try {
    const status = await provisionPanelUser(email, password, role, account.id);
    if (status === "duplicate") return { ok: false, message: "Ese correo ya está registrado." };
    if (status === "unconfigured") return { ok: false, message: "Falta configurar la clave de Supabase en el servidor." };
    if (status === "weak_password") return { ok: false, message: "La contraseña no cumple los requisitos de seguridad del proyecto." };
    if (status !== "ok") return { ok: false, message: "No se pudo crear la cuenta. Intenta nuevamente." };
  } catch {
    return { ok: false, message: "No se pudo confirmar la creación de la cuenta. Revisa la lista antes de reintentar." };
  }
  revalidatePath("/usuarios");
  return { ok: true, message: "Usuario creado. Ya puede iniciar sesión en el panel." };
}

export async function updatePanelRole(_: Result, form: FormData): Promise<Result> {
  const account = await actor("admin");
  if (!account) return { ok: false, message: "Se requiere el rol de Administrador." };
  const id = String(form.get("userId") ?? "");
  const role = form.get("role");
  if (!uuid.test(id) || id === account.id || !isOperationsRole(role)) {
    return { ok: false, message: "Selecciona otra cuenta y un rol válido." };
  }
  try {
    if (!(await changePanelRole(id, role, account.id))) return { ok: false, message: "No se pudo cambiar el rol de esa cuenta." };
  } catch {
    return { ok: false, message: "No se pudo guardar el rol. Intenta nuevamente." };
  }
  revalidatePath("/usuarios");
  return { ok: true, message: "Rol actualizado." };
}
