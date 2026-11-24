import { db } from "../supabase";
import { wa } from "../whatsapp/send";
import { logOutbound } from "../bot/repo";
import {
  computeFclQuote, computeQuote, LIMITS, modeOf, quoteMessage, validateCartons,
  type Carton, type Kind, type QuoteBreakdown,
} from "./pricing";
import { getActiveSurcharges, getCategoryName, getCurrentRate, getShippingSettings, priceContainers, saveQuote } from "./repo";

export type QuoteInput = {
  customerId: string;
  category: string;
  kind: Kind;
  cartons?: Carton[];
  containers?: { key: string; count: number }[];
  photo_path?: string | null;
};
export type QuoteOk = {
  ok: true;
  quote: { id: string; code: string; valid_until: string };
  category: string;
  b: QuoteBreakdown;
  registered: boolean;
  samples: boolean;
};
export type QuoteErr = { ok: false; error: string };

/** Ids of the buttons under a quote (kept here to avoid a dependency on the bot layer). */
const PROCEED = (id: string) => `quote:go:${id}`;
const AGAIN = "quote:new";

/**
 * Single source of truth for a shipping quote — used by the calculator page AND the AI agent:
 * validate → price with the engine → save → send the quote on WhatsApp with "proceed" buttons.
 */
export async function createAndSendQuote(input: QuoteInput): Promise<QuoteOk | QuoteErr> {
  const { customerId, category, kind } = input;
  if (!["air", "lcl", "fcl"].includes(kind)) return { ok: false, error: "يرجى اختيار طريقة الشحن" };

  const [settings, surcharges, categoryName] = await Promise.all([
    getShippingSettings(), getActiveSurcharges(modeOf(kind)), getCategoryName(category),
  ]);

  let b: QuoteBreakdown;
  const cartons = (input.cartons ?? []).map((c) => ({ qty: Number(c.qty), l: Number(c.l), w: Number(c.w), h: Number(c.h), kg: Number(c.kg) }));
  const containers = (input.containers ?? []).map((c) => ({ key: String(c.key), count: Number(c.count) }));

  if (kind === "fcl") {
    if (!containers.length) return { ok: false, error: "يرجى اختيار حاوية واحدة على الأقل" };
    if (containers.some((c) => !Number.isInteger(c.count) || c.count < 1 || c.count > LIMITS.maxContainers)) return { ok: false, error: "عدد الحاويات غير صحيح" };
    const lines = await priceContainers(containers);
    if (typeof lines === "string") return { ok: false, error: lines };
    b = computeFclQuote(lines, surcharges, settings);
  } else {
    const err = validateCartons(cartons);
    if (err) return { ok: false, error: err };
    const rate = await getCurrentRate(category, modeOf(kind));
    if (!rate) return { ok: false, error: "طريقة الشحن هذه غير متاحة لهذا النوع من البضائع" };
    b = computeQuote(kind, cartons, rate, surcharges, settings);
  }

  const valid_until = new Date(Date.now() + settings.quote_validity_days * 86_400_000).toISOString();
  const quote = await saveQuote({
    customer_id: customerId, category_key: category, cartons,
    containers: kind === "fcl" ? containers : undefined, photo_path: input.photo_path ?? null, b, valid_until,
  });

  const cust = await db().from("customers").select("wa_id, registration_complete").eq("id", customerId).single();
  try {
    const conv = await db().from("conversations").select("id").eq("customer_id", customerId).single();
    const text = quoteMessage({ code: quote.code, category: categoryName, valid_until, b });
    const r = await wa.buttons(cust.data!.wa_id, text, [
      { id: PROCEED(quote.id), title: "إكمال الطلب" },
      { id: AGAIN, title: "تسعيرة جديدة" },
    ]);
    if (conv.data) await logOutbound(conv.data.id, r.messages?.[0]?.id, "interactive", text);
  } catch (err) {
    console.error("[quote] WhatsApp copy failed", err);
  }

  return {
    ok: true, quote: { id: quote.id, code: quote.code, valid_until }, category: categoryName, b,
    registered: Boolean(cust.data?.registration_complete), samples: settings.prices_are_samples,
  };
}
