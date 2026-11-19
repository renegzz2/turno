import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ClipboardList, History } from "lucide-react";
import { AdjustmentForm } from "@/components/adjustment-form";
import { Shell } from "@/components/shell";
import { localDateTime, type ShiftAdjustment } from "@/lib/adjustments";
import { actor, editableShift, employees, shiftAdjustments } from "@/lib/backend";
import { formatDate, localDate, readCut, type Query } from "@/lib/periods";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ajustes de asistencia" };

export default async function AdjustmentsPage({ params, searchParams }: {
  params: Promise<{ id?: string[] }>; searchParams: Promise<Query>;
}) {
  const account = await actor("operations");
  if (!account) redirect("/acceso");
  const segments = (await params).id ?? [];
  const id = segments[0];
  if (segments.length > 1 || (id && !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))) notFound();
  const query = await searchParams;
  const today = localDate(new Date(), account.timezone);
  const cut = (query.from && query.to && readCut(query, today)) || undefined;
  const suffix = cut ? `?${new URLSearchParams(cut)}` : "";
  const [shift, staff, history] = await Promise.all([
    id ? editableShift(id) : null,
    id ? [] : employees(),
    shiftAdjustments(id),
  ]);
  if (id && !shift) notFound();
  const saved = id && typeof query.guardado === "string" && history.some((row) => row.id === query.guardado);

  return <Shell account={account} current="attendance">
    <header className="page-heading">
      <div><h1>{shift ? "Ajustar jornada" : "Agregar jornada"}</h1>
        <p>{shift ? `${shift.name} · Empleado ${shift.code}` : "Captura una entrada olvidada y completa la salida si ya la conoces."}</p>
      </div>
      <Link className="button secondary" href={`/asistencias${suffix}`}>Volver al corte</Link>
    </header>
    {saved && <p className="success adjustment-success" role="status">Ajuste guardado. Las horas actualizadas ya se usan en el corte.</p>}
    <div className="settings-grid">
      <section className="card cut-card" aria-labelledby="adjustment-title">
        <div className="section-heading"><div className="section-icon"><ClipboardList size={20}/></div>
          <div><h2 id="adjustment-title">{shift ? "Corregir checadas" : "Registro manual"}</h2>
            <p>{shift ? "Selecciona la entrada, la salida o ambas." : "El motivo quedará en el historial."}</p></div></div>
        <AdjustmentForm key={typeof query.guardado === "string" ? query.guardado : id ?? "new"}
          shift={shift ?? undefined} employees={staff} requestId={randomUUID()} cut={cut} timezone={account.timezone}
          entryDefault={shift ? localDateTime(shift.entered_at, account.timezone) : ""}
          exitDefault={shift?.exited_at ? localDateTime(shift.exited_at, account.timezone) : ""}/>
      </section>
      <section className="card cut-card" aria-labelledby="adjustment-history-title">
        <div className="section-heading"><div className="section-icon"><History size={20}/></div>
          <div><h2 id="adjustment-history-title">{shift ? "Historial de la jornada" : "Ajustes recientes"}</h2>
            <p>Valores anteriores, cambios y responsable.</p></div></div>
        {history.length ? <ol className="adjustment-history">
          {history.map((row) => <li key={row.id}><HistoryItem row={row} timezone={account.timezone} showWorker={!shift} suffix={suffix}/></li>)}
        </ol> : <p className="field-hint">Todavía no hay ajustes registrados.</p>}
      </section>
    </div>
  </Shell>;
}

function HistoryItem({ row, timezone, showWorker, suffix }: {
  row: ShiftAdjustment; timezone: string; showWorker: boolean; suffix: string;
}) {
  function format(value: string) {
    const [date, time] = localDateTime(value, timezone).split("T");
    return `${formatDate(date)} · ${time}`;
  }

  return <article className="history-item">
    <div className="history-meta">
      <strong>{row.before_entry ? "Corrección de jornada" : "Jornada agregada"}</strong>
      {showWorker && <Link href={`/asistencias/ajustes/${row.shift_id}${suffix}`}>{row.name} · {row.code}</Link>}
      <small>{row.made_by} · <time dateTime={row.made_at}>{format(row.made_at)}</time></small>
    </div>
    <p className="history-reason">{row.reason}</p>
    <dl className="history-values">
      <dt>Antes</dt><dd>{row.before_entry
        ? <><span>Entrada {format(row.before_entry)}</span><span>{row.before_exit ? `Salida ${format(row.before_exit)}` : "Sin salida"}</span></>
        : "Sin registro previo"}</dd>
      <dt>Después</dt><dd><span>Entrada {format(row.after_entry)}</span>
        <span>{row.after_exit ? `Salida ${format(row.after_exit)}` : "Sin salida"}</span></dd>
    </dl>
  </article>;
}
