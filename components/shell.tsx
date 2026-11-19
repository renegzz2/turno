import Link from "next/link";
import { CalendarDays, Clock3, LogOut, Monitor, ShieldCheck, UsersRound } from "lucide-react";
import { demo } from "@/lib/backend";
import { signOut } from "@/app/account-actions";
import { roleNames, type Actor } from "@/lib/models";

export function Brand() {
  return <div className="brand"><span className="brand-symbol"><Clock3 size={22} strokeWidth={2.6}/></span>
    <span>Turno<small>Control de asistencias</small></span>
  </div>;
}

export function Shell({ account, current, children }: { account: Actor; current: "attendance" | "people" | "users"; children: React.ReactNode }) {
  const section = { attendance: "Asistencias", people: "Personal", users: "Usuarios" }[current];
  return <div className="shell">
    <aside className="sidebar">
      <Link href="/asistencias" className="brand-link"><Brand /></Link>
      <div className="nav-area">
        <div className="nav-label">OPERACIÓN</div>
        <nav aria-label="Menú principal" className={account.role === "admin" ? "nav-with-users" : undefined}>
          <Link href="/asistencias" aria-current={current === "attendance" ? "page" : undefined}><CalendarDays size={19}/> Asistencias</Link>
          <Link href="/personal" aria-current={current === "people" ? "page" : undefined}><UsersRound size={19}/> Personal</Link>
          <Link href="/"><Monitor size={19}/> Checador</Link>
          {account.role === "admin" && <Link href="/usuarios" aria-current={current === "users" ? "page" : undefined}><ShieldCheck size={19}/> Usuarios</Link>}
        </nav>
      </div>
      <div className="workspace">
        <div className="workspace-icon">{account.name.slice(0, 1).toUpperCase()}</div>
        <div><strong>{account.name}</strong>{account.email && <small className="session-email" title={account.email}>{account.email}</small>}</div>
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
