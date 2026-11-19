import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Turno · Control de asistencias", template: "%s · Turno" },
  description: "Checador y cortes de asistencia para equipos de trabajo.",
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es-MX"><body>{children}</body></html>;
}
