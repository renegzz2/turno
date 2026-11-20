"use server";

import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { actor, saveCompanySettings } from "@/lib/backend";
import { isWeekday, maxLogoSize, type CompanyUpdate } from "@/lib/company";
import type { Result } from "@/lib/models";

export async function updateCompany(_: Result, form: FormData): Promise<Result> {
  if (!(await actor("admin"))) return { ok: false, message: "Se requiere el rol de Administrador." };
  const rawName = form.get("name");
  const rawWeek = form.get("weekStart");
  const name = typeof rawName === "string" ? rawName.trim() : "";
  const weekStart = typeof rawWeek === "string" && /^[0-6]$/.test(rawWeek) ? Number(rawWeek) : NaN;
  if (!name || name.length > 100 || !isWeekday(weekStart)) {
    return { ok: false, message: "Ingresa un nombre de hasta 100 caracteres y elige el inicio de semana laboral." };
  }

  const file = form.get("logo");
  const upload = file instanceof File && file.size > 0 ? file : null;
  const remove = form.get("removeLogo") === "on";
  if (upload && remove) return { ok: false, message: "Elige entre subir un logo o quitar el actual." };
  let update: CompanyUpdate = { name, weekStart, logoChange: remove ? "remove" : "keep" };
  if (upload) {
    if (upload.size > maxLogoSize) return { ok: false, message: "El archivo debe pesar como máximo 512 KB." };
    try {
      const image = sharp(Buffer.from(await upload.arrayBuffer()), { limitInputPixels: 4_194_304, failOn: "warning" });
      const { format, pages } = await image.metadata();
      if (["png", "jpeg", "webp"].includes(format ?? "") && (pages ?? 1) === 1) {
        const buffer = await image.rotate().resize(512, 512, { fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
        if (buffer.length <= 256 * 1024) update = { name, weekStart, logoChange: "replace", logo: buffer.toString("base64") };
      }
    } catch {
      // The decoder rejects malformed files and images larger than the pixel limit.
    }
    if (update.logoChange !== "replace") return { ok: false, message: "Sube una imagen PNG, JPG o WebP estática de hasta 4 megapíxeles." };
  }
  try {
    if (!(await saveCompanySettings(update))) return { ok: false, message: "No se pudo guardar la configuración." };
  } catch {
    return { ok: false, message: "No se pudo guardar la configuración. Comprueba la conexión y vuelve a intentar." };
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Configuración guardada." };
}
