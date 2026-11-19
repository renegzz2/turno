import { redirect } from "next/navigation";
import { CalendarDays, CalendarPlus, Clock3, Download, Hourglass, Monitor, Plus, UsersRound } from "lucide-react";
import Link from "next/link";
import { actor, exceptionsForCut, incidents, report } from "@/lib/backend";
import { Shell } from "@/components/shell";
import { CutPicker } from "@/components/cut-picker";
import { IncidentTable } from "@/components/incident-table";
import { ExceptionTable } from "@/components/exception-table";
import { formatDate, localDate, readCut, stamp, type Query } from "@/lib/periods";

export const dynamic = "force-dynamic";

const hours = (minutes: number) => `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;

export default async function Dashboard({ searchParams }: { searchParams: Promise<Query> }) {
  const account = await actor("operations");
  if (!account) redirect("/acceso");
  const today = localDate(new Date(), account.timezone);
  const cut = readCut(await searchParams, today);
  const [rows, recorded] = cut ? await Promise.all([report(cut.from, cut.to), incidents(cut)]) : [[], []];
  const exceptions = cut ? await exceptionsForCut(cut, account.timezone, recorded) : [];
  const count = new Set(rows.map((row) => row.code)).size;
  const total = rows.reduce((sum, row) => sum + (row.minutes ?? 0), 0);
  const open = rows.filter((row) => row.exited_at === null).length;
  const suffix = cut ? `?${new URLSearchParams(cut)}` : "";
  const download = cut && `/exportar${suffix}`;

  return <Shell account={account} current="attendance">
    <header className="page-heading">
      <div><h1>Asistencias</h1><p>Consulta entradas, salidas y horas trabajadas por periodo.</p></div>
      <div className="page-actions">
        <Link href="/" className="button secondary"><Monitor size={18}/> Abrir checador</Link>
        <Link href={`/asistencias/ajustes${suffix}`} className="button primary"><Plus size={18}/> Agregar jornada</Link>
      </div>
    </header>
    <CutPicker key={cut ? `${cut.period}/${cut.from}/${cut.to}` : "invalid"} initial={cut ?? readCut({}, today)!} today={today}/>
    {cut ? <>
      <div className="stats" aria-label="Resumen del corte">
        <Stat label="Personas con registros" value={String(count)} icon={<UsersRound size={21}/>} tone="purple"/>
        <Stat label="Horas en el corte" value={hours(total)} icon={<Clock3 size={21}/>} tone="mint"/>
        <Stat label="Jornadas sin salida" value={String(open)} icon={<Hourglass size={21}/>} tone="amber"/>
      </div>
      <section className="card register-card" aria-labelledby="records-title">
        <div className="records-heading"><div><h2 id="records-title">Registro de asistencias</h2>
          <p><CalendarDays size={15}/> {formatDate(cut.from)} — {formatDate(cut.to)}</p></div>
          {download && <a href={download} className="button secondary export"><Download size={18}/> Exportar Excel</a>}
        </div>
        {rows.length ? <div className="table-scroll"><table>
          <thead><tr><th>Trabajador</th><th>Entrada</th><th>Salida</th><th>Horas del corte</th><th>Estado</th><th>Acciones</th></tr></thead>
          <tbody>{rows.map((row) => {
            const entry = stamp(row.entered_at, account.timezone);
            const exit = row.exited_at && stamp(row.exited_at, account.timezone);
            return <tr key={row.id}>
              <td><div className="person"><span className="initials" aria-hidden="true">{row.name.split(/\s+/).slice(0, 2).map(word => word[0]).join("").toUpperCase()}</span>
                <div><strong>{row.name}</strong><small>Empleado {row.code}</small></div></div></td>
              <td><strong>{entry.time}</strong><small>{formatDate(entry.date)}</small></td>
              <td>{exit ? <><strong>{exit.time}</strong><small>{formatDate(exit.date)}</small></> : "—"}</td>
              <td>{row.minutes === null ? "—" : hours(row.minutes)}</td>
              <td><span className={exit ? "status complete" : "status pending"}>{exit ? "Completa" : "Sin salida"}</span></td>
              <td><Link href={`/asistencias/ajustes/${row.id}${suffix}`} className="button secondary compact"
                aria-label={`Ajustar jornada de ${row.name} del ${formatDate(entry.date)} a las ${entry.time}`}>Ajustar</Link></td>
            </tr>;
          })}</tbody>
        </table></div> : <div className="empty"><CalendarDays size={25}/><strong>Sin asistencias en este corte</strong><p>Prueba con otro rango de fechas o registra una checada.</p></div>}
        <div className="records-footer"><span>{rows.length} {rows.length === 1 ? "jornada" : "jornadas"}</span><span>Zona horaria · {account.timezone}</span></div>
      </section>
      <ExceptionTable rows={exceptions}/>
      <section className="card register-card cut-incidents" aria-labelledby="cut-incidents-title">
        <div className="records-heading"><div><h2 id="cut-incidents-title">Incidencias del corte</h2>
          <p>Incluye las incidencias que coinciden con el periodo.</p></div>
          <Link href="/personal#nueva-incidencia" className="button secondary"><CalendarPlus size={18}/> Registrar incidencia</Link>
        </div>
        <IncidentTable rows={recorded}/>
      </section>
    </> : <p role="alert" className="field-error">Elige fechas válidas para consultar el corte.</p>}
  </Shell>;
}

function Stat({ label, value, icon, tone }: { label: string; value: string; icon: React.ReactNode; tone: string }) {
  return <div className="card stat"><span className={`stat-icon ${tone}`}>{icon}</span><div><span>{label}</span><strong>{value}</strong></div></div>;
}
