import { setTimeout as delay } from "node:timers/promises";

const secret = process.env.TURNO_QR_JOB_SECRET;
const port = process.env.TURNO_QR_LOCAL_PORT ?? "3000";
const minute = 60_000;

if (!secret || !/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65_535) {
  console.error("Configura TURNO_QR_JOB_SECRET y usa un puerto local válido.");
  process.exit(1);
}

const endpoint = `http://127.0.0.1:${port}/api/qr-dispatch`;
console.log(`Tarea de QR activa para ${endpoint}`);

while (true) {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      redirect: "error",
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(minute),
    });
    if (response.status === 401) {
      console.error("Turno rechazó el secreto. Reinicia la aplicación con el mismo TURNO_QR_JOB_SECRET.");
      process.exit(1);
    }
    if (response.ok) {
      const { sent, retry } = await response.json();
      console.log(`${new Date().toLocaleTimeString()} · Enviados ${sent} · Pendientes de reintento ${retry}`);
    } else {
      console.error(`Turno devolvió HTTP ${response.status}. La tarea volverá a intentar en el próximo minuto.`);
    }
  } catch {
    console.error("Turno local no respondió. La tarea volverá a intentar en el próximo minuto.");
  }
  await delay(minute - Date.now() % minute);
}
