"use client";

import { useState } from "react";
import { CalendarDays, ChevronDown, SlidersHorizontal } from "lucide-react";
import { isDate, periodNames, preset, type Cut, type Period } from "@/lib/periods";

export function CutPicker({ initial, today }: { initial: Cut; today: string }) {
  const [cut, setCut] = useState(initial);
  const reversed = Boolean(cut.from && cut.to && cut.from > cut.to);

  function choose(period: Period) {
    setCut(period === "custom" ? { ...cut, period } : preset(period, isDate(cut.from) ? cut.from : today));
  }

  function updateStart(value: string) {
    if ((cut.period === "week" || cut.period === "fortnight") && isDate(value)) {
      setCut(preset(cut.period, value));
    } else {
      setCut({ ...cut, from: value, period: cut.period === "month" || cut.period === "half" ? "custom" : cut.period });
    }
  }

  return <section className="card cut-card" aria-labelledby="cut-title">
    <div className="section-heading"><div className="section-icon"><CalendarDays size={20}/></div>
      <div><h2 id="cut-title">Periodo de corte</h2><p>Elige un periodo o define tus propias fechas.</p></div>
    </div>
    <form action="/asistencias" className="cut-form">
      <label>Tipo de corte<span className="select-wrap">
        <select name="period" value={cut.period} onChange={(event) => choose(event.target.value as Period)}>
          {Object.entries(periodNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
        </select><ChevronDown size={16} aria-hidden="true"/>
      </span></label>
      <label>Fecha de inicio<input type="date" name="from" required value={cut.from}
        onInput={(event) => updateStart(event.currentTarget.value)}/></label>
      <label>Fecha de fin<input type="date" name="to" required min={cut.from || undefined} value={cut.to}
        onInput={(event) => setCut({ ...cut, period: "custom", to: event.currentTarget.value })}/></label>
      <button className="button primary" disabled={reversed}><SlidersHorizontal size={17}/> Aplicar filtro</button>
    </form>
    {reversed && <p className="field-error" role="alert">La fecha de fin debe ser igual o posterior a la fecha de inicio.</p>}
  </section>;
}
