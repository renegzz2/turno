"use server";

import { revalidatePath } from "next/cache";
import { actor, demo, persistQrContact } from "@/lib/backend";
import { qrDeliveryChannels } from "@/lib/qr-delivery";
import type { Result } from "@/lib/models";

export async function saveQrContact(_: Result, form: FormData): Promise<Result> {
  if (!(await actor("admin"))) return { ok: false, message: "Se requiere el rol de Administrador." };
  const id = String(form.get("employeeId") ?? "");
  const channel = form.get("channel");
  const destination = String(form.get("destination") ?? "").trim();
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)
    || (channel !== "off" && channel !== "email" && channel !== "whatsapp")) {
    return { ok: false, message: "Revisa el trabajador y el canal de envío." };
  }
  if (demo || (channel !== "off" && !qrDeliveryChannels().includes(channel))) {
    return { ok: false, message: "Ese canal requiere configuración en el servidor." };
  }
  if (channel === "email" && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination) || destination.length > 254)) {
    return { ok: false, message: "Ingresa un correo electrónico válido." };
  }
  if (channel === "whatsapp" && (!/^\+[1-9]\d{7,14}$/.test(destination) || form.get("consent") !== "on")) {
    return { ok: false, message: "Ingresa el teléfono con código de país y confirma el permiso del trabajador." };
  }
  try {
    if (!await persistQrContact(id, channel === "off" ? null : channel, channel === "off" ? null : destination)) {
      return { ok: false, message: "No se pudo guardar el contacto." };
    }
  } catch {
    return { ok: false, message: "No se pudo confirmar el cambio. Intenta nuevamente." };
  }
  revalidatePath(`/personal/${id}`);
  return { ok: true, message: channel === "off" ? "Envíos desactivados." : "Envíos configurados para los turnos del trabajador." };
}
