import { NextResponse, type NextRequest } from "next/server";
import { peekFormToken } from "@/lib/forms/tokens";
import type { Kind } from "@/lib/shipping/pricing";
import { submitShipment, type ItemInput } from "@/lib/shipping/quote-service";

export const runtime = "nodejs";

const bad = (error: string) => NextResponse.json({ error }, { status: 422 });

/** Calculator submit (JSON). Photos were already uploaded one by one to /api/quote/photo. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const tok = await peekFormToken(String(body.token ?? ""), "quote");
  if (!tok) return NextResponse.json({ error: "expired" }, { status: 410 });
  if (!Array.isArray(body.items)) return bad("بيانات غير صحيحة");

  const r = await submitShipment({
    customerId: tok.customer_id,
    kind: String(body.kind ?? "") as Kind,
    items: body.items as ItemInput[],
    city: String(body.city ?? ""),
    requirePhotos: true,
    containers: Array.isArray(body.containers) ? body.containers : [],
    port: body.port,
    factory_address: body.factory_address,
    services: Array.isArray(body.services) ? body.services : [],
    notes: body.notes,
  });
  if (!r.ok) return bad(r.error);
  return NextResponse.json(r);
}
