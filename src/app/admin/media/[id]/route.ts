import { NextResponse, type NextRequest } from "next/server";
import { currentStaff } from "@/lib/auth/staff";
import { env } from "@/lib/env";

export const runtime = "nodejs";

/**
 * Streams a customer's WhatsApp media (image, voice note, document) to logged-in staff.
 * WhatsApp keeps inbound media for a limited time; after that this returns 404.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await currentStaff())) return new NextResponse("unauthorized", { status: 401 });
  const { id } = await params;
  if (!/^\d+$/.test(id)) return new NextResponse("bad id", { status: 400 });

  const e = env();
  const auth = { Authorization: `Bearer ${e.WHATSAPP_TOKEN}` };
  const meta = await fetch(`https://graph.facebook.com/${e.WHATSAPP_API_VERSION}/${id}`, { headers: auth });
  if (!meta.ok) return new NextResponse("not found", { status: 404 });
  const { url, mime_type } = (await meta.json()) as { url: string; mime_type?: string };

  const file = await fetch(url, { headers: auth });
  if (!file.ok || !file.body) return new NextResponse("not found", { status: 404 });
  return new NextResponse(file.body, {
    headers: { "Content-Type": mime_type ?? "application/octet-stream", "Cache-Control": "private, max-age=3600" },
  });
}
