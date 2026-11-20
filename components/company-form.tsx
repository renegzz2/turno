"use client";

import Image from "next/image";
import { useActionState, useState } from "react";
import { ChevronDown } from "lucide-react";
import { updateCompany } from "@/app/configuracion/actions";
import { companyLogoUrl, isWeekday, workweekLabel, type CompanySettings } from "@/lib/company";
import { weekdays } from "@/lib/schedules";
import { Feedback } from "./personnel-actions";

export function CompanyForm({ settings }: { settings: CompanySettings }) {
  const [state, action, pending] = useActionState(updateCompany, { ok: false, message: "" });
  const [weekStart, setWeekStart] = useState(settings.workweek_start);
  const logoUrl = companyLogoUrl(settings.logo_revision);

  return <form action={action} className="stack company-form">
    <label>Nombre de la empresa<input name="name" required maxLength={100} defaultValue={settings.name}/></label>
    <div className="stack">
      {logoUrl && <Image className="company-logo-preview" src={logoUrl} alt="Logo actual de la empresa" width={124} height={72} unoptimized/>}
      <label>{logoUrl ? "Reemplazar logo" : "Logo de la empresa"}
        <input type="file" name="logo" accept="image/png,image/jpeg,image/webp" aria-describedby="logo-help"/>
      </label>
      <p id="logo-help" className="field-hint">PNG, JPG o WebP estático de hasta 512 KB y 4 megapíxeles. Se muestra en el panel y el checador.</p>
      {logoUrl && <label className="workday-toggle"><input type="checkbox" name="removeLogo"/> Quitar logo actual</label>}
    </div>
    <label>Inicio de la semana laboral<span className="select-wrap">
      <select name="weekStart" value={weekStart} aria-describedby="workweek-help" onChange={(event) => {
        const next = Number(event.target.value);
        if (isWeekday(next)) setWeekStart(next);
      }}>
        {weekdays.map((day, index) => <option key={day} value={index}>{day}</option>)}
      </select><ChevronDown size={16} aria-hidden="true"/>
    </span></label>
    <p id="workweek-help" className="field-hint">{workweekLabel(weekStart)}. Se usa para calcular horas extra en cualquier corte, incluidos los históricos.</p>
    <div><button className="button primary" disabled={pending}>{pending ? "Guardando…" : "Guardar configuración"}</button></div>
    <Feedback state={state}/>
  </form>;
}
