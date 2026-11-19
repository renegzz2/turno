"use client";

import { useEffect, useRef, useState } from "react";
import { ScanLine } from "lucide-react";
import { isQrCode, normalizeQr } from "@/lib/qr";

export function KioskQr() {
  const input = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [scanning, setScanning] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!scanning) return;
    let finished = false;
    let stop: (() => void) | undefined;
    async function scan() {
      try {
        const { BrowserQRCodeReader } = await import("@zxing/browser");
        if (finished || !video.current) return;
        const reader = new BrowserQRCodeReader();
        const controls = await reader.decodeFromConstraints(
          { audio: false, video: { facingMode: { ideal: "environment" } } },
          video.current, (result, _, active) => {
            if (!result || finished) return;
            const value = normalizeQr(result.getText());
            if (!isQrCode(value)) return;
            finished = true;
            active.stop();
            if (input.current) input.current.value = value;
            setNotice("QR leído. Elige Entrada o Salida.");
            setScanning(false);
          },
        );
        if (finished) controls.stop();
        else stop = () => controls.stop();
      } catch {
        if (!finished) {
          setNotice("La cámara no está disponible. Escribe el código que recibiste.");
          setScanning(false);
        }
      }
    }
    void scan();
    return () => { finished = true; stop?.(); };
  }, [scanning]);

  return <div className="stack">
    <label>QR del turno (si lo recibiste)
      <input ref={input} name="qr" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={40}
        onInput={() => setNotice("")}/>
    </label>
    <button type="button" className="button secondary" onClick={() => { setNotice(""); setScanning(!scanning); }}>
      <ScanLine size={18}/> {scanning ? "Cerrar cámara" : "Escanear QR"}
    </button>
    <video ref={video} hidden={!scanning} muted playsInline className="kiosk-qr-video"/>
    {notice && <p className="field-hint" role="status">{notice}</p>}
  </div>;
}
