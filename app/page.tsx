import { randomUUID } from "node:crypto";
import Link from "next/link";
import { LayoutDashboard } from "lucide-react";
import { demo, publicKiosk } from "@/lib/backend";
import { punchErrors } from "@/lib/models";
import { Brand } from "@/components/shell";
import { companyLogoUrl } from "@/lib/company";
import { KioskForm } from "@/components/forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Checador" };

export default async function Kiosk() {
  const terminal = await publicKiosk();
  return <main className="standalone">
    <div className="standalone-top"><Brand name={terminal?.name} logo={companyLogoUrl(terminal?.logo_revision, true)}/>
      <Link href="/acceso" className="button secondary" prefetch={false}><LayoutDashboard size={18}/> Ir al panel</Link>
    </div>
    <div className="standalone-content">
      {terminal ? <>
        <KioskForm requestId={randomUUID()} timezone={terminal.timezone} serverTime={new Date().toISOString()}/>
        {demo && <p className="standalone-note">Modo demostración · Usa el PIN asignado en Personal</p>}
      </> : <div className="card kiosk-card">
        <h1>Registra tu asistencia</h1><p role="status">{punchErrors.unavailable}</p>
      </div>}
    </div>
  </main>;
}
