import { redirect } from "next/navigation";
import { UserPlus } from "lucide-react";
import { CreateAccountForm, UserRoleForm } from "@/components/account-forms";
import { Shell } from "@/components/shell";
import { currentAccount } from "@/lib/backend";
import { isOperationsRole, roleNames } from "@/lib/models";
import { canCreatePanelUsers, listPanelUsers } from "@/lib/panel-users";

export const dynamic = "force-dynamic";
export const metadata = { title: "Usuarios" };

export default async function UsersPage() {
  const account = await currentAccount();
  if (!account || !isOperationsRole(account.role)) redirect("/acceso");
  if (account.role !== "admin") redirect("/asistencias");
  const users = await listPanelUsers();
  return <Shell account={account} current="users">
    <header className="page-heading"><div><h1>Usuarios</h1><p>Gestiona las cuentas con acceso al panel de asistencias.</p></div></header>
    <div className="settings-grid">
      <section className="card register-card" aria-labelledby="user-list-title">
        <div className="records-heading"><div><h2 id="user-list-title">Cuentas del panel</h2>
          <p>{users.length} {users.length === 1 ? "cuenta" : "cuentas"}</p></div></div>
        {users.length ? <div className="table-scroll"><table>
          <thead><tr><th>Correo electrónico</th><th>Rol actual</th><th>Cambiar rol</th></tr></thead>
          <tbody>{users.map((user) => <tr key={user.id}>
            <td><strong>{user.email}</strong>{user.id === account.id && <small>Tu cuenta</small>}</td>
            <td><span className={`status ${user.role === "admin" ? "incident-justified" : "complete"}`}>{roleNames[user.role]}</span></td>
            <td>{user.id === account.id ? "—" : <UserRoleForm {...user}/>}</td>
          </tr>)}</tbody>
        </table></div> : <div className="empty">Todavía no hay cuentas con correo registrado.</div>}
      </section>
      <section className="card cut-card" aria-labelledby="new-user-title">
        <div className="section-heading"><div className="section-icon"><UserPlus size={20}/></div>
          <div><h2 id="new-user-title">Nuevo usuario</h2><p>Asigna acceso como Administrador o Líder.</p></div></div>
        {canCreatePanelUsers ? <CreateAccountForm/> : <p className="field-hint">Configura la clave secreta de Supabase en el servidor para crear usuarios.</p>}
      </section>
    </div>
  </Shell>;
}
