import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/supabase";
import { peekFormToken } from "@/lib/forms/tokens";
import {
  computeFclQuote, computeQuote, LIMITS, modeOf, quoteMessage, validateCartons,
  type Carton, type Kind, type QuoteBreakdown,
} from "@/lib/shipping/pricing";
import { getActiveSurcharges, getCategoryName, getCurrentRate, getShippingSettings, priceContainers, saveQuote } from "@/lib/shipping/repo";
import { QUOTE_IDS } from "@/lib/bot/quotes";
import { logOutbound } from "@/lib/bot/repo";
import { wa } from "@/lib/whatsapp/send";

export const runtime = "nodejs";

const MAX_PHOTO_BYTES = 4 * 1024 * 1024; // Vercel request limit is ~4.5 MB; the browser resizes before upload
const bad = (error: string) => NextResponse.json({ error }, { status: 422 });

export async function POST(req: NextRequest) {
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }

  const tok = await peekFormToken(String(form.get("token") ?? ""), "quote");
  if (!tok) return NextResponse.json({ error: "expired" }, { status: 410 });

  const category = String(form.get("category") ?? "");
  const kind = String(form.get("kind") ?? "") as Kind;
  if (!["air", "lcl", "fcl"].includes(kind)) return bad("اختار طريقة الشحن");

  const [settings, surcharges, categoryName] = await Promise.all([
    getShippingSettings(), getActiveSurcharges(modeOf(kind)), getCategoryName(category),
  ]);

  let b: QuoteBreakdown;
  let cartons: Carton[] = [];
  let containers: { key: string; count: number }[] | undefined;

  if (kind === "fcl") {
    try {
      containers = (JSON.parse(String(form.get("containers") ?? "[]")) as { key: string; count: number }[])
        .map((c) => ({ key: String(c.key), count: Number(c.count) }));
    } catch { return bad("بيانات الحاويات غير صحيحة"); }
    if (!containers.length) return bad("اختار حاوية واحدة على الأقل");
    if (containers.some((c) => !Number.isInteger(c.count) || c.count < 1 || c.count > LIMITS.maxContainers)) return bad("عدد الحاويات غير صحيح");
    const lines = await priceContainers(containers);
    if (typeof lines === "string") return bad(lines);
    b = computeFclQuote(lines, surcharges, settings);
  } else {
    try {
      cartons = (JSON.parse(String(form.get("cartons") ?? "[]")) as Carton[]).map((c) => ({
        qty: Number(c.qty), l: Number(c.l), w: Number(c.w), h: Number(c.h), kg: Number(c.kg),
      }));
    } catch { return bad("بيانات الكراتين غير صحيحة"); }
    const cartonError = validateCartons(cartons);
    if (cartonError) return bad(cartonError);
    const rate = await getCurrentRate(category, modeOf(kind));
    if (!rate) return bad("طريقة الشحن دي غير متاحة لنوع البضاعة ده");
    b = computeQuote(kind, cartons, rate, surcharges, settings);
  }

  // Optional product photo → private bucket
  let photo_path: string | null = null;
  const photo = form.get("photo");
  if (photo instanceof File && photo.size > 0) {
    if (!photo.type.startsWith("image/")) return bad("الصورة لازم تكون صورة (JPG / PNG)");
    if (photo.size > MAX_PHOTO_BYTES) return bad("حجم الصورة كبير، اختار صورة أصغر");
    const path = `${tok.customer_id}/${randomUUID()}.jpg`;
    const up = await db().storage.from("quote-photos").upload(path, Buffer.from(await photo.arrayBuffer()), { contentType: photo.type });
    if (up.error) console.error("[quote] photo upload failed", up.error);
    else photo_path = path;
  }

  const valid_until = new Date(Date.now() + settings.quote_validity_days * 86_400_000).toISOString();
  const quote = await saveQuote({ customer_id: tok.customer_id, category_key: category, cartons, containers, photo_path, b, valid_until });

  // Copy on WhatsApp with "proceed" button (the customer just messaged us → 24h window open)
  const cust = await db().from("customers").select("wa_id, registration_complete").eq("id", tok.customer_id).single();
  try {
    const conv = await db().from("conversations").select("id").eq("customer_id", tok.customer_id).single();
    const r = await wa.buttons(cust.data!.wa_id, quoteMessage({ code: quote.code, category: categoryName, valid_until, b }), [
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
