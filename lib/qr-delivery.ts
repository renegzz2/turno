import "server-only";

import QRCode from "qrcode";
import type { QrChannel } from "./qr";

export type QrDelivery = { id: string; code: string; channel: QrChannel; destination: string; expires_at: string };

const resendKey = process.env.RESEND_API_KEY;
const sender = process.env.TURNO_QR_FROM_EMAIL;
const whatsappToken = process.env.TURNO_WHATSAPP_ACCESS_TOKEN;
const phoneId = process.env.TURNO_WHATSAPP_PHONE_NUMBER_ID;
const graphVersion = process.env.TURNO_WHATSAPP_GRAPH_VERSION;
const template = process.env.TURNO_WHATSAPP_QR_TEMPLATE;
const language = process.env.TURNO_WHATSAPP_QR_LANGUAGE ?? "es_MX";

export function qrDeliveryChannels(): QrChannel[] {
  const channels: QrChannel[] = [];
  if (!process.env.TURNO_QR_JOB_SECRET || !process.env.SUPABASE_SECRET_KEY) return channels;
  if (resendKey && sender) channels.push("email");
  if (whatsappToken && phoneId && /^\d+$/.test(phoneId) && graphVersion && /^v\d+\.\d+$/.test(graphVersion) && template) {
    channels.push("whatsapp");
  }
  return channels;
}

export async function sendShiftQr(delivery: QrDelivery) {
  const png = await QRCode.toBuffer(`turno:${delivery.code}`, { width: 300, margin: 4, errorCorrectionLevel: "M" });
  if (Date.parse(delivery.expires_at) <= Date.now()) return false;
  if (delivery.channel === "email") {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST", signal: AbortSignal.timeout(7000),
      headers: {
        Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json",
        "Idempotency-Key": `turno-qr/${delivery.id}`,
      },
      body: JSON.stringify({
        from: sender, to: [delivery.destination], subject: "Tu código de asistencia de Turno",
        text: `Abre el QR adjunto o escribe el código ${delivery.code} en el checador e ingresa tu PIN. Usa el QR más reciente para la entrada. Conserva el que aceptó Turno para tu salida.`,
        attachments: [{ filename: "turno-qr.png", content: png.toString("base64") }],
      }),
    });
    return response.ok;
  }

  const graph = `https://graph.facebook.com/${graphVersion}/${phoneId}`;
  const headers = { Authorization: `Bearer ${whatsappToken}` };
  const media = new FormData();
  media.set("messaging_product", "whatsapp");
  media.set("type", "image/png");
  media.set("file", new Blob([new Uint8Array(png)], { type: "image/png" }), "turno-qr.png");
  const upload = await fetch(`${graph}/media`, { method: "POST", headers, body: media, signal: AbortSignal.timeout(7000) });
  if (!upload.ok || Date.parse(delivery.expires_at) <= Date.now()) return false;
  const { id } = await upload.json() as { id?: string };
  if (!id) return false;
  const response = await fetch(`${graph}/messages`, {
    method: "POST", signal: AbortSignal.timeout(7000), headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp", to: delivery.destination.slice(1), type: "template",
      template: {
        name: template, language: { code: language }, components: [
          { type: "header", parameters: [{ type: "image", image: { id } }] },
          { type: "body", parameters: [{ type: "text", text: delivery.code }] },
        ],
      },
    }),
  });
  return response.ok;
}
