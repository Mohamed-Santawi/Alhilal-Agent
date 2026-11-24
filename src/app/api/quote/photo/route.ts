import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/supabase";
import { peekFormToken } from "@/lib/forms/tokens";

export const runtime = "nodejs";

const MAX_BYTES = 4 * 1024 * 1024; // Vercel request limit is ~4.5 MB; the browser resizes before upload

/** Uploads ONE product photo (private bucket) and returns its path. One request per photo keeps each request small. */
export async function POST(req: NextRequest) {
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }

  const tok = await peekFormToken(String(form.get("token") ?? ""), "quote");
  if (!tok) return NextResponse.json({ error: "expired" }, { status: 410 });

  const photo = form.get("photo");
  if (!(photo instanceof File) || photo.size === 0) return NextResponse.json({ error: "يرجى اختيار صورة" }, { status: 422 });
  if (!photo.type.startsWith("image/")) return NextResponse.json({ error: "يجب أن يكون الملف صورة (JPG / PNG)" }, { status: 422 });
  if (photo.size > MAX_BYTES) return NextResponse.json({ error: "حجم الصورة كبير، يرجى اختيار صورة أصغر" }, { status: 422 });

  const path = `${tok.customer_id}/${randomUUID()}.jpg`;
  const up = await db().storage.from("quote-photos").upload(path, Buffer.from(await photo.arrayBuffer()), { contentType: photo.type });
  if (up.error) {
    console.error("[quote] photo upload failed", up.error);
    return NextResponse.json({ error: "تعذّر رفع الصورة، يرجى المحاولة مرة أخرى" }, { status: 500 });
  }
  return NextResponse.json({ path });
}
