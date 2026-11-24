import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/supabase";
import { peekFormToken } from "@/lib/forms/tokens";
import type { Carton, Kind } from "@/lib/shipping/pricing";
import { createAndSendQuote } from "@/lib/shipping/quote-service";

export const runtime = "nodejs";

const MAX_PHOTO_BYTES = 4 * 1024 * 1024; // Vercel request limit is ~4.5 MB; the browser resizes before upload
const bad = (error: string) => NextResponse.json({ error }, { status: 422 });

export async function POST(req: NextRequest) {
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }

  const tok = await peekFormToken(String(form.get("token") ?? ""), "quote");
  if (!tok) return NextResponse.json({ error: "expired" }, { status: 410 });

  let cartons: Carton[] = [];
  let containers: { key: string; count: number }[] = [];
  try {
    cartons = JSON.parse(String(form.get("cartons") ?? "[]"));
    containers = JSON.parse(String(form.get("containers") ?? "[]"));
  } catch { return bad("بيانات غير صحيحة"); }

  // Optional product photo → private bucket
  let photo_path: string | null = null;
  const photo = form.get("photo");
  if (photo instanceof File && photo.size > 0) {
    if (!photo.type.startsWith("image/")) return bad("يجب أن يكون الملف صورة (JPG / PNG)");
    if (photo.size > MAX_PHOTO_BYTES) return bad("حجم الصورة كبير، يرجى اختيار صورة أصغر");
    const path = `${tok.customer_id}/${randomUUID()}.jpg`;
    const up = await db().storage.from("quote-photos").upload(path, Buffer.from(await photo.arrayBuffer()), { contentType: photo.type });
    if (up.error) console.error("[quote] photo upload failed", up.error);
    else photo_path = path;
  }

  const r = await createAndSendQuote({
    customerId: tok.customer_id,
    category: String(form.get("category") ?? ""),
    kind: String(form.get("kind") ?? "") as Kind,
    cartons, containers, photo_path,
  });
  if (!r.ok) return bad(r.error);
  return NextResponse.json({ quote: r.quote, category: r.category, b: r.b, registered: r.registered, samples: r.samples });
}
