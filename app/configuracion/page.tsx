import { redirect } from "next/navigation";
import { Building2 } from "lucide-react";
import { actor, companySettings } from "@/lib/backend";
import { CompanyForm } from "@/components/company-form";
import { Shell } from "@/components/shell";

export const dynamic = "force-dynamic";
export const metadata = { title: "Configuración general" };

export default async function CompanySettingsPage() {
  const account = await actor("operations");
  if (!account) redirect("/acceso");
  if (account.role !== "admin") redirect("/asistencias");
  const settings = await companySettings();

  return <Shell account={account} current="settings">
    <header className="page-heading"><div><h1>Configuración general</h1>
      <p>Personaliza Turno y define la semana laboral de tu empresa.</p></div></header>
    <section className="card cut-card company-card" aria-labelledby="company-title">
      <div className="section-heading"><div className="section-icon"><Building2 size={20}/></div>
        <h2 id="company-title">Datos de la empresa</h2></div>
      {settings ? <CompanyForm settings={settings}/> : <p role="status">Aplica la migración 012 de Supabase para habilitar esta configuración.</p>}
    </section>
  </Shell>;
}
