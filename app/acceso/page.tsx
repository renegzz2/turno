import Link from "next/link";
import { Brand } from "@/components/shell";
import { LoginForm } from "@/components/forms";
import { demo, supabase } from "@/lib/backend";
import { demoEmails, demoPassword } from "@/lib/demo-credentials";

export const dynamic = "force-dynamic";
export const metadata = { title: "Acceso" };

export default async function Access() {
  const configured = demo || Boolean(await supabase());
  return <main className="standalone">
    <div className="standalone-top"><Brand/></div>
    <div className="standalone-content">
      <div className="card kiosk-card">
        <h1>Inicia sesión en el panel</h1>
        {configured ? <>
          <p>Accede con tu cuenta de Administrador o Líder.</p>
          <LoginForm/>
          {demo && <div className="demo-access">
            <strong>Cuentas de demostración</strong>
            <p>Administrador · <code>{demoEmails.admin}</code></p>
            <p>Líder · <code>{demoEmails.leader}</code></p>
            <p>Contraseña · <code>{demoPassword}</code></p>
          </div>}
        </>
          : <p>Configura las variables de Supabase para habilitar el acceso.</p>}
        <Link className="access-link" href="/">Volver al checador</Link>
      </div>
    </div>
  </main>;
}
