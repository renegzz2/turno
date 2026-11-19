export type QrChannel = "email" | "whatsapp";
export type QrContact = { channel: QrChannel; destination: string };

export function normalizeQr(value: string) {
  return value.trim().replace(/^turno:/i, "").replace(/[\s-]+/g, "").toUpperCase();
}

export function isQrCode(value: string) {
  return /^[0-9A-F]{18}$/.test(value);
}
