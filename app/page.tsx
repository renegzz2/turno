import { randomUUID } from "node:crypto";
import Link from "next/link";
import { LayoutDashboard } from "lucide-react";
import { demo, publicKiosk } from "@/lib/backend";
import { punchErrors } from "@/lib/models";
import { Brand } from "@/components/shell";
import { KioskForm } from "@/components/forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Checador" };

export default async function Kiosk() {
  const terminal = await publicKiosk();
  return <main className="standalone">
    <div className="standalone-top"><Brand/>
      <Link href="/acceso" className="button secondary" prefetch={false}><LayoutDashboard size={18}/> Ir al panel</Link>
    </div>
    <div className="standalone-content">
      {terminal ? <>
        <KioskForm requestId={randomUUID()} timezone={terminal.timezone} serverTime={new Date().toISOString()}/>
        <p className="standalone-note">{demo ? "Modo demostración · Usa el PIN asignado en Personal" : terminal.name}</p>
      </> : <div className="card kiosk-card">
        <h1>Registra tu asistencia</h1><p role="status">{punchErrors.unavailable}</p>
      </div>}
    </div>
  </main>;
}
