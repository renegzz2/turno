"use client";

import { useActionState, useState } from "react";
import { ChevronDown, Save } from "lucide-react";
import { saveShiftAdjustment } from "@/app/actions";
import type { EditableShift } from "@/lib/adjustments";
import type { Employee, Result } from "@/lib/models";
import type { Cut } from "@/lib/periods";
import { Feedback } from "./personnel-actions";

const initial: Result = { ok: false, message: "" };

export function AdjustmentForm({ shift, employees, requestId, cut, entryDefault = "", exitDefault = "", timezone }: {
  shift?: EditableShift; employees?: Employee[]; requestId: string; cut?: Cut;
  entryDefault?: string; exitDefault?: string; timezone: string;
}) {
  const [state, action, pending] = useActionState(saveShiftAdjustment, initial);
  const [employee, setEmployee] = useState(shift?.employee_id ?? "");
  const [entry, setEntry] = useState(entryDefault);
  const [exit, setExit] = useState(exitDefault);
  const [changeEntry, setChangeEntry] = useState(!shift);
  const [changeExit, setChangeExit] = useState(Boolean(shift && !shift.exited_at));
  const [reason, setReason] = useState("");

  return <form action={action} className="stack">
    <input type="hidden" name="requestId" value={requestId}/>
    {cut && Object.entries(cut).map(([key, value]) => <input key={key} type="hidden" name={key} value={value}/>)}
    {shift ? <>
      <input type="hidden" name="employeeId" value={employee}/>
      <input type="hidden" name="shiftId" value={shift.id}/>
      <input type="hidden" name="expectedEntry" value={shift.entered_at}/>
      <input type="hidden" name="expectedExit" value={shift.exited_at ?? ""}/>
    </> : <label>Trabajador<span className="select-wrap">
      <select name="employeeId" value={employee} onChange={(event) => setEmployee(event.target.value)} required>
        <option value="" disabled>Selecciona un trabajador</option>
        {employees?.map((row) => <option key={row.id} value={row.id}>{row.name} · {row.code}{row.active ? "" : " · Baja"}</option>)}
      </select><ChevronDown size={16} aria-hidden="true"/>
    </span></label>}
    {shift && <div className="adjustment-checks">
      <label className="workday-toggle"><input type="checkbox" checked={changeEntry}
        onChange={(event) => setChangeEntry(event.target.checked)}/> Corregir entrada</label>
      <label className="workday-toggle"><input type="checkbox" checked={changeExit}
        onChange={(event) => setChangeExit(event.target.checked)}/> {shift.exited_at ? "Corregir salida" : "Completar salida"}</label>
    </div>}
    <div className="adjustment-times">
      <label>Fecha y hora de entrada<input type="datetime-local" name="entry" step="1"
        disabled={!changeEntry} required={changeEntry} value={entry} onInput={(event) => setEntry(event.currentTarget.value)}/></label>
      <label>Fecha y hora de salida{!shift && " (opcional)"}<input type="datetime-local" name="exit" step="1"
        disabled={Boolean(shift && !changeExit)} required={Boolean(shift && changeExit)}
        value={exit} onInput={(event) => setExit(event.currentTarget.value)}/></label>
    </div>
    <p className="field-hint">Zona horaria de la empresa · {timezone}{!shift && ". Si dejas la salida vacía, la jornada queda abierta."}</p>
    <label>Motivo del ajuste<textarea name="reason" required maxLength={500} rows={3} value={reason}
      onChange={(event) => setReason(event.target.value)} placeholder="Ej. Olvidó checar su salida al terminar el turno."/></label>
    <button className="button primary" disabled={pending || Boolean(!shift && !employees?.length) || (!changeEntry && !changeExit)}>
      <Save size={18}/> {pending ? "Guardando…" : "Guardar ajuste"}
    </button>
    <Feedback state={state}/>
  </form>;
}
