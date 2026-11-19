"use client";

import { useActionState } from "react";
import { CalendarPlus, ChevronDown } from "lucide-react";
import { changeEmployeeStatus, justifyDetectedAbsence, saveIncident, voidIncident } from "@/app/actions";
import { incidentNames, type Employee, type Result } from "@/lib/models";

const initial: Result = { ok: false, message: "" };

export function Feedback({ state }: { state: Result }) {
  return <div role="status">{state.message && <p className={state.ok ? "success" : "field-error"}>{state.message}</p>}</div>;
}

export function EmployeeStatusButton({ employee }: { employee: Employee }) {
  const [state, action, pending] = useActionState(changeEmployeeStatus, initial);
  const label = employee.active ? "Dar de baja" : "Reactivar";
  return <form action={action} className="status-control">
    <input type="hidden" name="employeeId" value={employee.id}/>
    <input type="hidden" name="active" value={String(!employee.active)}/>
    <button className="button secondary compact" disabled={pending} aria-label={`${label} a ${employee.name}`}>{label}</button>
    <Feedback state={state}/>
  </form>;
}

export function IncidentForm({ employees, today, requestId }: { employees: Employee[]; today: string; requestId: string }) {
  const [state, action, pending] = useActionState<Awaited<ReturnType<typeof saveIncident>>, FormData>(saveIncident, initial);
  return <form action={action} className="stack">
    <input type="hidden" name="requestId" value={state.nextRequest ?? requestId}/>
    <label>Trabajador<span className="select-wrap">
      <select name="employeeId" required defaultValue="">
        <option value="" disabled>Selecciona un trabajador</option>
        {employees.map(({ id, name, code, active }) => <option key={id} value={id}>{name} · {code}{active ? "" : " · Baja"}</option>)}
      </select><ChevronDown size={16} aria-hidden="true"/>
    </span></label>
    <label>Tipo de incidencia<span className="select-wrap">
      <select name="kind" required defaultValue="">
        <option value="" disabled>Selecciona un tipo</option>
        {Object.entries(incidentNames).map(([kind, name]) => <option key={kind} value={kind}>{name}</option>)}
      </select><ChevronDown size={16} aria-hidden="true"/>
    </span></label>
    <div className="incident-dates">
      <label>Desde<input name="from" type="date" defaultValue={today} required/></label>
      <label>Hasta (opcional)<input name="to" type="date" aria-describedby="incidence-date-help"/></label>
    </div>
    <p id="incidence-date-help" className="field-hint">Deja «Hasta» vacío para registrar un solo día.</p>
    <button disabled={pending || !employees.length} className="button primary"><CalendarPlus size={18}/> {pending ? "Guardando…" : "Registrar incidencia"}</button>
    <Feedback state={state}/>
  </form>;
}

export function CancelIncidentButton({ id, name }: { id: string; name: string }) {
  const [state, action, pending] = useActionState(voidIncident, initial);
  return <form action={action} className="status-control">
    <input type="hidden" name="incidentId" value={id}/>
    <button className="button secondary compact" disabled={pending} aria-label={`Anular incidencia de ${name}`}>Anular</button>
    <Feedback state={state}/>
  </form>;
}

export function JustifyAbsenceButton({ id, name, day }: { id: string; name: string; day: string }) {
  const [state, action, pending] = useActionState(justifyDetectedAbsence, initial);
  return <form action={action} className="status-control">
    <input type="hidden" name="employeeId" value={id}/>
    <input type="hidden" name="day" value={day}/>
    <button className="button secondary compact" disabled={pending} aria-label={`Justificar falta de ${name} del ${day}`}>
      {pending ? "Justificando…" : "Justificar falta"}
    </button>
    <Feedback state={state}/>
  </form>;
}
