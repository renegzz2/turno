import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { qrDeliveryChannels, sendShiftQr, type QrDelivery } from "@/lib/qr-delivery";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const secret = process.env.TURNO_QR_JOB_SECRET;
  const credentials = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  if (!secret || credentials.length !== expected.length || !timingSafeEqual(credentials, expected)) {
    return Response.json({ ok: false }, { status: 401 });
  }
  const channels = qrDeliveryChannels();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key || !channels.length) return Response.json({ ok: false }, { status: 503 });
  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: issueError } = await supabase.rpc("attendance_issue_shift_qr", { p_channels: channels });
  if (issueError) return Response.json({ ok: false }, { status: 503 });
  const { data, error } = await supabase.rpc("attendance_claim_qr_deliveries", { p_channels: channels, p_limit: 32 });
  if (error) return Response.json({ ok: false }, { status: 503 });
  const deliveries = (data ?? []) as QrDelivery[];
  let sent = 0;
  for (let offset = 0; offset < deliveries.length; offset += 8) {
    const results = await Promise.all(deliveries.slice(offset, offset + 8).map(async (delivery) => {
      let delivered = false;
      try {
        const { data: current } = await supabase.rpc("attendance_qr_delivery_current", { p_id: delivery.id });
        if (current === true) delivered = await sendShiftQr(delivery);
      } catch {
        // A failed provider call can be retried while this code is current.
      }
      const { error: finishError } = await supabase.rpc("attendance_finish_qr_delivery", { p_id: delivery.id, p_sent: delivered });
      return delivered && !finishError;
    }));
    sent += results.filter(Boolean).length;
  }
  return Response.json({ ok: true, sent, retry: deliveries.length - sent });
}
