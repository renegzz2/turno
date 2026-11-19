"use client";

import { useActionState, useState } from "react";
import { Clock3, KeyRound } from "lucide-react";
import { updatePin, updateSchedule } from "@/app/actions";
import { Feedback } from "./personnel-actions";
import type { Result } from "@/lib/models";
import { weekdays, type Schedule } from "@/lib/schedules";

const initial: Result = { ok: false, message: "" };

export function ScheduleForm({ employeeId, today, from, schedule }: {
  employeeId: string; today: string; from: string; schedule?: Schedule;
}) {
  const [state, action, pending] = useActionState(updateSchedule, initial);
  const [draft, setDraft] = useState(
    weekdays.map((_, index) => {
      const hours = schedule?.week[index];
      return { working: schedule ? Boolean(hours) : index < 5, start: hours?.[0] ?? "09:00", end: hours?.[1] ?? "18:00" };
    }),
  );

  function changeDay(index: number, change: Partial<(typeof draft)[number]>) {
    setDraft((current) => current.map((day, position) => position === index ? { ...day, ...change } : day));
  }

  return <form action={action} className="stack">
    <input type="hidden" name="employeeId" value={employeeId}/>
    <div className="incident-dates">
      <label>Vigente desde<input type="date" name="from" defaultValue={from} min={today} required/></label>
      <label>Tolerancia de entrada (min)<input type="number" name="tolerance" defaultValue={schedule?.tolerance ?? 0} min={0} max={1439} required/></label>
    </div>
    <fieldset className="weekly-grid">
      <legend>Días y horas de trabajo</legend>
      {weekdays.map((day, index) => <div className="weekly-row" key={day}>
        <label className="workday-toggle"><input type="checkbox" name={`work-${index}`} checked={draft[index].working}
          onChange={(event) => changeDay(index, { working: event.target.checked })}/>
          <span>{day}<small>{draft[index].working ? "Laboral" : "Descanso"}</small></span>
        </label>
        <label>Entrada<input type="time" name={`start-${index}`} aria-label={`Entrada del ${day.toLowerCase()}`}
          value={draft[index].start} onChange={(event) => changeDay(index, { start: event.target.value })}
          disabled={!draft[index].working} required={draft[index].working}/></label>
        <label>Salida<input type="time" name={`end-${index}`} aria-label={`Salida del ${day.toLowerCase()}`}
          value={draft[index].end} onChange={(event) => changeDay(index, { end: event.target.value })}
          disabled={!draft[index].working} required={draft[index].working}/></label>
      </div>)}
    </fieldset>
    <p className="field-hint">Desmarca un día para indicar descanso. Si la salida es antes de la entrada, el turno termina al día siguiente.</p>
    <button className="button primary" disabled={pending}><Clock3 size={18}/> {pending ? "Guardando…" : "Guardar horario"}</button>
    <Feedback state={state}/>
  </form>;
}

export function ResetPinForm({ employeeId }: { employeeId: string }) {
  const [state, action, pending] = useActionState(updatePin, initial);
  return <form action={action} className="stack">
    <input type="hidden" name="employeeId" value={employeeId}/>
    <label>Nuevo PIN<input type="password" name="pin" autoComplete="new-password"
      inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required/></label>
    <label>Confirma el nuevo PIN<input type="password" name="confirmPin" autoComplete="new-password"
      inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required/></label>
    <button className="button primary" disabled={pending}><KeyRound size={18}/> {pending ? "Guardando…" : "Restablecer PIN"}</button>
    <Feedback state={state}/>
  </form>;
}
