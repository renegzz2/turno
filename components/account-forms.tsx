"use client";

import { useActionState } from "react";
import { ChevronDown, UserPlus } from "lucide-react";
import { createPanelUser, updatePanelRole } from "@/app/account-actions";
import { roleNames, type PanelRole, type Result } from "@/lib/models";
import { Feedback } from "./personnel-actions";

const initial: Result = { ok: false, message: "" };

function RoleSelect({ role, label }: { role: PanelRole; label?: string }) {
  return <span className="select-wrap"><select name="role" defaultValue={role} aria-label={label} required>
    <option value="leader">{roleNames.leader}</option>
    <option value="admin">{roleNames.admin}</option>
  </select><ChevronDown size={16} aria-hidden="true"/></span>;
}

export function CreateAccountForm() {
  const [state, action, busy] = useActionState(createPanelUser, initial);
  return <form action={action} className="stack">
    <label>Correo electrónico<input name="email" type="email" maxLength={254} autoComplete="off" required/></label>
    <label>Rol<RoleSelect role="leader"/></label>
    <label>Contraseña inicial<input name="password" type="password" minLength={12} maxLength={72}
      autoComplete="new-password" aria-describedby="account-password-hint" required/></label>
    <p className="field-hint" id="account-password-hint">Usa al menos 12 caracteres.</p>
    <label>Confirma la contraseña<input name="confirmation" type="password" minLength={12} maxLength={72}
      autoComplete="new-password" required/></label>
    <button className="button primary" disabled={busy}><UserPlus size={18}/> {busy ? "Creando…" : "Crear usuario"}</button>
    <Feedback state={state}/>
  </form>;
}

export function UserRoleForm({ id, email, role }: { id: string; email: string; role: PanelRole }) {
  const [state, action, busy] = useActionState(updatePanelRole, initial);
  return <form action={action} className="stack">
    <input type="hidden" name="userId" value={id}/>
    <div className="user-role-control">
      <RoleSelect key={role} role={role} label={`Rol de ${email}`}/>
      <button className="button secondary compact" disabled={busy} aria-label={`Guardar rol de ${email}`}>Guardar</button>
    </div>
    <Feedback state={state}/>
  </form>;
}
