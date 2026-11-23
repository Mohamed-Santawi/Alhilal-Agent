import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/supabase";
import { peekFormToken } from "@/lib/forms/tokens";
import { computeQuote, quoteMessage, validateCartons, type Carton, type Mode } from "@/lib/shipping/pricing";
import { getActiveSurcharges, getCategoryName, getCurrentRate, getShippingSettings, saveQuote } from "@/lib/shipping/repo";
import { QUOTE_IDS } from "@/lib/bot/quotes";
import { logOutbound } from "@/lib/bot/repo";
import { wa } from "@/lib/whatsapp/send";

export const runtime = "nodejs";

const MAX_PHOTO_BYTES = 4 * 1024 * 1024; // Vercel request limit is ~4.5 MB; the browser resizes before upload

export async function POST(req: NextRequest) {
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }

  const tok = await peekFormToken(String(form.get("token") ?? ""), "quote");
  if (!tok) return NextResponse.json({ error: "expired" }, { status: 410 });

  const category = String(form.get("category") ?? "");
  const mode = String(form.get("mode") ?? "") as Mode;
  if (mode !== "sea" && mode !== "air") return NextResponse.json({ error: "اختار طريقة الشحن" }, { status: 422 });

  let cartons: Carton[];
  try {
    cartons = (JSON.parse(String(form.get("cartons") ?? "[]")) as Carton[]).map((c) => ({
      qty: Number(c.qty), l: Number(c.l), w: Number(c.w), h: Number(c.h), kg: Number(c.kg),
    }));
  } catch { return NextResponse.json({ error: "بيانات الكراتين غير صحيحة" }, { status: 422 }); }
  const cartonError = validateCartons(cartons);
  if (cartonError) return NextResponse.json({ error: cartonError }, { status: 422 });

  const rate = await getCurrentRate(category, mode);
  if (!rate) return NextResponse.json({ error: "طريقة الشحن دي غير متاحة لنوع البضاعة ده" }, { status: 422 });

  const [settings, surcharges, categoryName] = await Promise.all([getShippingSettings(), getActiveSurcharges(mode), getCategoryName(category)]);
  const b = computeQuote(mode, cartons, rate, surcharges, settings);

  // Optional product photo → private bucket
  let photo_path: string | null = null;
  const photo = form.get("photo");
  if (photo instanceof File && photo.size > 0) {
    if (!photo.type.startsWith("image/")) return NextResponse.json({ error: "الصورة لازم تكون صورة (JPG / PNG)" }, { status: 422 });
    if (photo.size > MAX_PHOTO_BYTES) return NextResponse.json({ error: "حجم الصورة كبير، اختار صورة أصغر" }, { status: 422 });
    const path = `${tok.customer_id}/${randomUUID()}.jpg`;
    const up = await db().storage.from("quote-photos").upload(path, Buffer.from(await photo.arrayBuffer()), { contentType: photo.type });
    if (up.error) console.error("[quote] photo upload failed", up.error);
    else photo_path = path;
  }

  const valid_until = new Date(Date.now() + settings.quote_validity_days * 86_400_000).toISOString();
  const quote = await saveQuote({ customer_id: tok.customer_id, category_key: category, mode, cartons, photo_path, b, valid_until });

  // Copy on WhatsApp with "proceed" button (the customer just messaged us → 24h window open)
  const cust = await db().from("customers").select("wa_id, registration_complete").eq("id", tok.customer_id).single();
  try {
    const conv = await db().from("conversations").select("id").eq("customer_id", tok.customer_id).single();
    const text = quoteMessage({ code: quote.code, category: categoryName, valid_until, b });
    const r = await wa.buttons(cust.data!.wa_id, text, [
      { id: QUOTE_IDS.proceed(quote.id), title: "كمّل الطلب" },
      { id: QUOTE_IDS.again, title: "تسعيرة جديدة" },
    ]);
    if (conv.data) await logOutbound(conv.data.id, r.messages?.[0]?.id, "interactive", `[quote ${quote.code}]`);
  } catch (err) {
    console.error("[quote] WhatsApp copy failed", err);
  }

  return NextResponse.json({
    quote: { id: quote.id, code: quote.code, valid_until },
    category: categoryName,
    b,
    registered: Boolean(cust.data?.registration_complete),
    samples: settings.prices_are_samples,
  });
}
