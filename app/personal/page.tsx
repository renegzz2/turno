import { randomUUID } from "node:crypto";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarPlus, Download, FileSpreadsheet, UserPlus } from "lucide-react";
import { actor, employees, incidents } from "@/lib/backend";
import { localDate } from "@/lib/periods";
import { Shell } from "@/components/shell";
import { EmployeeForm } from "@/components/forms";
import { EmployeeStatusButton, IncidentForm } from "@/components/personnel-actions";
import { IncidentTable } from "@/components/incident-table";
import { PersonnelImportForm } from "@/components/personnel-import-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Personal" };

export default async function People() {
  const account = await actor("operations");
  if (!account) redirect("/acceso");
  const isAdmin = account.role === "admin";
  const scheduleLabel = isAdmin ? "Horario y PIN" : "Horario";
  const [rows, recorded] = await Promise.all([employees(), incidents()]);
  const active = rows.filter((row) => row.active).length;
  const today = localDate(new Date(), account.timezone);
  return <Shell account={account} current="people">
    <header className="page-heading"><div><h1>Personal</h1><p>{isAdmin
      ? "Administra trabajadores, horarios e incidencias de asistencia."
      : "Consulta a los trabajadores y gestiona sus horarios e incidencias."}</p></div></header>
    <div className={isAdmin ? "people-grid" : undefined}>
      <section className="card register-card" aria-labelledby="people-title">
        <div className="records-heading"><div><h2 id="people-title">Trabajadores</h2><p>{active} {active === 1 ? "activo" : "activos"} · {rows.length - active} de baja</p></div></div>
        {rows.length ? <div className="table-scroll"><table><thead><tr><th>Nombre</th><th>N.º de empleado</th><th>Estado</th><th>Acciones</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.name}</strong></td><td>{row.code}</td>
            <td><span className={row.active ? "status complete" : "status inactive"}>{row.active ? "Activo" : "Baja"}</span>
              {isAdmin && !row.pin_configured && <small>PIN pendiente</small>}</td>
            <td><div className="employee-actions">
              <Link className="button secondary compact" href={`/personal/${row.id}`} aria-label={`${scheduleLabel} de ${row.name}`}>{scheduleLabel}</Link>
              {isAdmin && <EmployeeStatusButton employee={row}/>}
            </div></td></tr>)}</tbody>
        </table></div> : <div className="empty">{isAdmin ? "Agrega a tu primer trabajador." : "Todavía no hay trabajadores registrados."}</div>}
      </section>
      {isAdmin && <div className="stack">
        <section className="card cut-card" aria-labelledby="import-personnel">
          <div className="section-heading"><div className="section-icon"><FileSpreadsheet size={20}/></div>
            <div><h2 id="import-personnel">Carga masiva desde Excel</h2><p>Da de alta trabajadores o actualiza los datos de un número de empleado existente.</p></div></div>
          <div className="import-instructions">
            <a className="button secondary" href="/plantilla-personal.xlsx" download><Download size={18}/> Descargar plantilla</a>
            <p className="field-hint">Usa una fila por trabajador. Si capturas horas, deja vacías las dos celdas de cada descanso. Para un trabajador existente, dejar todas las horas o el PIN en blanco conserva esos datos.</p>
          </div>
          <PersonnelImportForm today={today}/>
        </section>
        <section className="card cut-card" aria-labelledby="new-person">
          <div className="section-heading"><div className="section-icon"><UserPlus size={20}/></div><div><h2 id="new-person">Alta de trabajador</h2><p>Asigna su número de empleado y PIN.</p></div></div>
          <EmployeeForm/>
        </section>
      </div>}
    </div>
    <div className="people-grid personnel-incidents">
      <section className="card register-card" aria-labelledby="incident-history-title">
        <div className="records-heading"><div><h2 id="incident-history-title">Incidencias registradas</h2></div></div>
        <IncidentTable rows={recorded} editable={isAdmin}/>
      </section>
      <section className="card cut-card" id="nueva-incidencia" aria-labelledby="new-incidence">
        <div className="section-heading"><div className="section-icon"><CalendarPlus size={20}/></div>
          <div><h2 id="new-incidence">Nueva incidencia</h2><p>Registra una falta, incapacidad o vacaciones.</p></div></div>
        <IncidentForm employees={rows} today={today} requestId={randomUUID()}/>
      </section>
    </div>
  </Shell>;
}
