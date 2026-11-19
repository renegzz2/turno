"use client";

import { useActionState } from "react";
import { Upload } from "lucide-react";
import { uploadPersonnel } from "@/app/personnel-import-actions";
import { maxImportRows } from "@/lib/personnel-import";

export function PersonnelImportForm({ today }: { today: string }) {
  const [state, action, pending] = useActionState(uploadPersonnel, { ok: false, message: "" });
  return <form action={action} className="stack">
    <label>Archivo de Excel
      <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        name="workbook" required aria-describedby="import-file-hint"/>
    </label>
    <p className="field-hint" id="import-file-hint">Formato .xlsx, hasta 512 KB y {maxImportRows} trabajadores por carga.</p>
    <label>Horario vigente desde<input type="date" name="from" min={today} defaultValue={today} required/></label>
    <button className="button primary" disabled={pending}><Upload size={18}/> {pending ? "Importando…" : "Importar Excel"}</button>
    <div role="status">{state.message && <div className={state.ok ? "success" : "field-error"}>
      <p>{state.message}</p>
      {state.issues && <ul className="import-issues">{state.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>}
      {Boolean(state.remaining) && <p>Hay {state.remaining} observaciones más en el archivo.</p>}
    </div>}</div>
  </form>;
}
