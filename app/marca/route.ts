import { companyLogo } from "@/lib/backend";
import { validLogoRevision } from "@/lib/company";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const revision = params.get("v") ?? "";
  if (!validLogoRevision(revision)) return new Response(null, { status: 404 });
  const logo = await companyLogo(revision, params.get("checador") === "1");
  if (!logo) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(Buffer.from(logo, "base64")), { headers: {
    "Content-Type": "image/webp", "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store",
  } });
}
