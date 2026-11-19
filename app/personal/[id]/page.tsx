import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Clock3, KeyRound, QrCode } from "lucide-react";
import { actor, plans, qrContact } from "@/lib/backend";
import { qrDeliveryChannels } from "@/lib/qr-delivery";
import { QrContactForm } from "@/components/qr-contact-form";
import { formatDate, isDate, localDate } from "@/lib/periods";
import { Shell } from "@/components/shell";
import { ResetPinForm, ScheduleForm } from "@/components/schedule-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ficha del trabajador" };

export default async function EmployeeSettings({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ desde?: string }>;
}) {
  const account = await actor("operations");
  if (!account) redirect("/acceso");
  const { id } = await params;
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) notFound();
  const [employee] = await plans(id);
  if (!employee) notFound();
  const contact = account.role === "admin" ? await qrContact(id) : null;
  const today = localDate(new Date(), account.timezone);
  const current = employee.schedules.find((schedule) => schedule.starts_on <= today);
  const { desde } = await searchParams;
  const future = isDate(desde) && desde >= today ? employee.schedules.find((schedule) => schedule.starts_on === desde) : undefined;
  return <Shell account={account} current="people">
    <header className="page-heading">
      <div><h1>{employee.name}</h1><p>Empleado {employee.code} · {employee.active ? "Activo" : "Baja"}</p></div>
      <Link className="button secondary" href="/personal">Volver a Personal</Link>
    </header>
    <div className="settings-grid">
      <section className="card cut-card" aria-labelledby="weekly-title">
        <div className="section-heading"><div className="section-icon"><Clock3 size={20}/></div>
          <div><h2 id="weekly-title">Horario semanal</h2><p>Define sus días laborales y la tolerancia para registrar la entrada.</p></div></div>
        <ScheduleForm key={future?.starts_on ?? today} employeeId={id} today={today} from={future?.starts_on ?? today} schedule={future ?? current}/>
      </section>
      <div className="stack">
        {account.role === "admin" && <section className="card cut-card" aria-labelledby="pin-title">
          <div className="section-heading"><div className="section-icon"><KeyRound size={20}/></div>
            <div><h2 id="pin-title">Configurar o restablecer PIN</h2><p>Asigna un PIN de seis dígitos. El cambio es inmediato.</p></div></div>
          <ResetPinForm employeeId={id}/>
        </section>}
        {account.role === "admin" && <section className="card cut-card" aria-labelledby="qr-title">
          <div className="section-heading"><div className="section-icon"><QrCode size={20}/></div>
            <div><h2 id="qr-title">QR por turno</h2><p>Envía un código que se usa junto con el PIN.</p></div></div>
          <QrContactForm employeeId={id} contact={contact} channels={qrDeliveryChannels()}/>
        </section>}
        <section className="card cut-card" aria-labelledby="saved-title">
          <div className="section-heading"><div><h2 id="saved-title">Horarios guardados</h2><p>{current ? `Vigente desde el ${formatDate(current.starts_on)}.` : "Sin horario vigente."}</p></div></div>
          {employee.schedules.length > 0 && <ul className="saved-schedules">
            {employee.schedules.map((schedule) => <li key={schedule.starts_on}>
              <time dateTime={schedule.starts_on}>{formatDate(schedule.starts_on)}</time>
              {schedule.starts_on >= today
                ? <Link className="button secondary compact" href={`/personal/${id}?desde=${schedule.starts_on}`}>Editar</Link>
                : <small>{schedule === current ? "Vigente" : "Anterior"}</small>}
            </li>)}
          </ul>}
        </section>
      </div>
    </div>
  </Shell>;
}
