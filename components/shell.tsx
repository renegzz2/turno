import Link from "next/link";
import Image from "next/image";
import { CalendarDays, Clock3, LogOut, Monitor, Settings2, ShieldCheck, UsersRound } from "lucide-react";
import { companySettings, demo } from "@/lib/backend";
import { companyLogoUrl } from "@/lib/company";
import { signOut } from "@/app/account-actions";
import { roleNames, type Actor } from "@/lib/models";

export function Brand({ name = "Turno", logo }: { name?: string; logo?: string }) {
  return <div className="brand">
    {logo ? <Image className="brand-logo" src={logo} alt="" width={44} height={44} unoptimized/>
      : <span className="brand-symbol"><Clock3 size={22} strokeWidth={2.6}/></span>}
    <span className="brand-name">{name}<small>Control de asistencias</small></span>
  </div>;
}

export async function Shell({ account, current, children }: { account: Actor; current: "attendance" | "people" | "users" | "settings"; children: React.ReactNode }) {
  const section = { attendance: "Asistencias", people: "Personal", users: "Usuarios", settings: "Configuración" }[current];
  const settings = await companySettings();
  const name = settings?.name ?? account.name;
  return <div className="shell">
    <aside className="sidebar">
      <Link href="/asistencias" className="brand-link"><Brand name={name} logo={companyLogoUrl(settings?.logo_revision)}/></Link>
      <div className="nav-area">
        <div className="nav-label">OPERACIÓN</div>
        <nav aria-label="Menú principal" className={account.role === "admin" ? "nav-with-users" : undefined}>
          <Link href="/asistencias" aria-current={current === "attendance" ? "page" : undefined}><CalendarDays size={19}/> Asistencias</Link>
          <Link href="/personal" aria-current={current === "people" ? "page" : undefined}><UsersRound size={19}/> Personal</Link>
          <Link href="/"><Monitor size={19}/> Checador</Link>
          {account.role === "admin" && <>
            <Link href="/usuarios" aria-current={current === "users" ? "page" : undefined}><ShieldCheck size={19}/> Usuarios</Link>
            <Link href="/configuracion" aria-current={current === "settings" ? "page" : undefined}><Settings2 size={19}/> Configuración</Link>
          </>}
        </nav>
      </div>
      <div className="workspace">
        <div className="workspace-icon" aria-hidden="true">{(account.email ?? name).slice(0, 1).toUpperCase()}</div>
        <strong className="session-email" title={account.email ?? undefined}>{account.email ?? roleNames[account.role]}</strong>
      </div>
    </aside>
    <main className="page">
      <div className="topbar"><span>Operación <span className="breadcrumb-slash">/</span> <strong>{section}</strong></span>
        <div className="role-tools">
          <span className="demo-tag">{demo ? "Demo · " : ""}{roleNames[account.role]}</span>
          <form action={signOut}><button className="button secondary compact"><LogOut size={16}/> Cerrar sesión</button></form>
        </div>
      </div>
      <div className="content">{children}</div>
    </main>
  </div>;
}
