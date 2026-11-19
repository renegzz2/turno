"use client";

import { useActionState, useState } from "react";
import { ChevronDown } from "lucide-react";
import { saveQrContact } from "@/app/qr-actions";
import type { QrChannel, QrContact } from "@/lib/qr";
import { Feedback } from "./personnel-actions";

export function QrContactForm({ employeeId, contact, channels }: {
  employeeId: string; contact: QrContact | null; channels: QrChannel[];
}) {
  const [state, action, pending] = useActionState(saveQrContact, { ok: false, message: "" });
  const [channel, setChannel] = useState(contact?.channel ?? "off");
  if (!channels.length && !contact) return <p className="field-hint">Configura el servicio de correo o WhatsApp en el servidor para habilitar los envíos.</p>;
  return <form action={action} className="stack">
    <input type="hidden" name="employeeId" value={employeeId}/>
    <label>Canal de envío<span className="select-wrap">
      <select name="channel" value={channel} onChange={(event) => setChannel(event.target.value as QrChannel | "off")}>
        <option value="off">Solo PIN</option>
        <option value="email" disabled={!channels.includes("email") && contact?.channel !== "email"}>Correo electrónico</option>
        <option value="whatsapp" disabled={!channels.includes("whatsapp") && contact?.channel !== "whatsapp"}>WhatsApp</option>
      </select><ChevronDown size={16} aria-hidden="true"/>
    </span></label>
    {channel !== "off" && <label>{channel === "email" ? "Correo del trabajador" : "Teléfono con código de país"}
      <input key={channel} name="destination" required maxLength={channel === "email" ? 254 : 16}
        type={channel === "email" ? "email" : "tel"} placeholder={channel === "email" ? undefined : "+525512345678"}
        defaultValue={channel === contact?.channel ? contact.destination : ""}/>
    </label>}
    {channel === "whatsapp" && <label className="workday-toggle"><input type="checkbox" name="consent" required
      defaultChecked={contact?.channel === "whatsapp"}/> El trabajador autorizó los envíos por WhatsApp.</label>}
    <button className="button primary" disabled={pending}>Guardar envío</button>
    <Feedback state={state}/>
  </form>;
}
