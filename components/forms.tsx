"use client";

import { useActionState, useEffect, useState } from "react";
import { Clock3, LogIn, LogOut, UserPlus } from "lucide-react";
import { mark, saveEmployee } from "@/app/actions";
import { signIn } from "@/app/account-actions";
import { stamp } from "@/lib/periods";
import { KioskQr } from "./kiosk-qr";

const initial = { ok: false, message: "" };

export function KioskForm({ requestId, timezone, serverTime }: { requestId: string; timezone: string; serverTime: string }) {
  const [state, action, busy] = useActionState<Awaited<ReturnType<typeof mark>>, FormData>(mark, initial);
  const [hidden, setHidden] = useState<typeof state>();
  const [now, setNow] = useState(serverTime);
  useEffect(() => {
    const started = Date.now();
    const ticker = setInterval(() => setNow(new Date(Date.parse(serverTime) + Date.now() - started).toISOString()), 1000);
    return () => clearInterval(ticker);
  }, [serverTime]);
  useEffect(() => {
    if (!state.message) return;
    const timer = setTimeout(() => setHidden(state), 12000);
    return () => clearTimeout(timer);
  }, [state]);

  return <>
    <div className="kiosk-clock"><Clock3 size={23}/><time>{stamp(now, timezone).time}</time></div>
    <div className="card kiosk-card">
      <h1>Registra tu asistencia</h1>
      <p>Ingresa tu número de empleado y PIN.</p>
      <form action={action} className="stack">
        <input type="hidden" name="requestId" value={state.nextRequest ?? requestId}/>
        <label>Número de empleado<input autoComplete="off" name="code" inputMode="numeric" pattern="[0-9]{1,12}" maxLength={12} required placeholder="Ej. 101"/></label>
        <label>PIN de 6 dígitos<input name="pin" type="password" autoComplete="off" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required placeholder="••••••"/></label>
        <KioskQr key={state.nextRequest ?? requestId}/>
        <div className="kiosk-buttons">
          <button className="button primary" name="direction" value="entrada" disabled={busy}><LogIn size={21}/> Entrada</button>
          <button className="button secondary" name="direction" value="salida" disabled={busy}><LogOut size={21}/> Salida</button>
        </div>
        <div className="feedback" role="status" aria-live="polite">
          {busy ? <p>Registrando checada…</p> : state !== hidden && <Notice {...state}/>}
        </div>
      </form>
    </div>
  </>;
}

export function EmployeeForm() {
  const [state, action, busy] = useActionState(saveEmployee, initial);
  return <form action={action} className="stack">
    <label>Nombre completo<input name="name" maxLength={100} required placeholder="Ej. Mariana López"/></label>
    <label>Número de empleado<input name="code" inputMode="numeric" pattern="[0-9]{1,12}" maxLength={12} required placeholder="Ej. 107"/></label>
    <label>PIN de 6 dígitos<input name="pin" type="password" autoComplete="new-password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required/></label>
    <button className="button primary" disabled={busy}><UserPlus size={18}/> {busy ? "Guardando…" : "Agregar trabajador"}</button>
    <div role="status"><Notice {...state}/></div>
  </form>;
}

export function LoginForm() {
  const [state, action, busy] = useActionState(signIn, initial);
  return <form action={action} className="stack">
    <label>Correo electrónico<input name="email" type="email" required autoComplete="username" maxLength={254}/></label>
    <label>Contraseña<input name="password" type="password" required autoComplete="current-password"/></label>
    <button className="button primary" disabled={busy}><LogIn size={18}/> {busy ? "Iniciando sesión…" : "Iniciar sesión"}</button>
    <div role="status"><Notice {...state}/></div>
  </form>;
}

function Notice({ ok, message }: { ok: boolean; message: string }) {
  return message ? <p className={ok ? "success" : "field-error"}>{message}</p> : null;
}
