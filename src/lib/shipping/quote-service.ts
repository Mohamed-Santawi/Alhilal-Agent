import { db } from "../supabase";
import { wa } from "../whatsapp/send";
import { audit, logOutbound } from "../bot/repo";
import { createTask } from "../bot/tasks";
import {
  computeQuote, FCL_SERVICES, fclRequestMessage, isRemoteCity, LIMITS, measure, modeOf, portName, PORTS,
  quoteMessage, serviceName, validateCartons, type Carton, type Kind, type Notes, type PricedItem, type QuoteBreakdown,
} from "./pricing";
import {
  getActiveSurcharges, getCategoryNames, getCurrentRates, getShippingSettings, listContainerOptions, listMainCities,
  saveQuote, transitFor, type StoredItem,
} from "./repo";

export type ItemInput = { category: string; product: string; cartons: Carton[]; photos?: string[] };
export type ShipmentInput = {
  customerId: string;
  kind: Kind;
  items: ItemInput[];
  city: string;
  /** The calculator page requires photos; the AI agent can't collect them. */
  requirePhotos?: boolean;
  // FCL only
  containers?: { key: string; count: number }[];
  port?: string;
  factory_address?: string;
  services?: string[];
  notes?: string;
};
export type QuoteOk = {
  ok: true; type: "quote";
  quote: { id: string; code: string; valid_until: string };
  b: QuoteBreakdown; notes: Notes; registered: boolean; samples: boolean;
};
export type FclOk = { ok: true; type: "fcl"; code: string };
export type ShipErr = { ok: false; error: string };

/** Ids of the buttons under a quote (kept here to avoid a dependency on the bot layer). */
const PROCEED = (id: string) => `quote:go:${id}`;
const AGAIN = "quote:new";

const clean = (s: unknown, max: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const toCarton = (c: Carton): Carton => ({ qty: Number(c.qty), l: Number(c.l), w: Number(c.w), h: Number(c.h), kg: Number(c.kg) });

/** Checks the product lines; returns them with category names, or an Arabic error. */
async function validateItems(input: ShipmentInput): Promise<StoredItem[] | string> {
  const items = input.items ?? [];
  if (!items.length) return "أضف منتجاً واحداً على الأقل";
  if (items.length > LIMITS.maxItems) return `أقصى عدد للمنتجات ${LIMITS.maxItems}`;
  const names = await getCategoryNames([...new Set(items.map((i) => String(i.category)))]);

  const out: StoredItem[] = [];
  for (const [i, it] of items.entries()) {
    const label = `المنتج ${i + 1}`;
    const product = clean(it.product, 120);
    if (!product) return `${label}: يرجى كتابة اسم المنتج`;
    const category_ar = names.get(String(it.category));
    if (!category_ar) return `${label}: يرجى اختيار نوع البضاعة`;
    const cartons = (it.cartons ?? []).map(toCarton);
    const err = validateCartons(cartons, label);
    if (err) return err;
    const photos = (it.photos ?? []).map(String).filter((p) => p.startsWith(`${input.customerId}/`) && !p.includes(".."));
    if (input.requirePhotos && !photos.length) return `${label}: يرجى إرفاق صورة واحدة على الأقل للمنتج`;
    if (photos.length > LIMITS.maxPhotos) return `${label}: أقصى عدد للصور ${LIMITS.maxPhotos}`;
    out.push({ category_key: String(it.category), category_ar, product, cartons, photos });
  }
  return out;
}

async function sendWa(customerId: string, text: string, buttons?: { id: string; title: string }[]) {
  try {
    const [cust, conv] = await Promise.all([
      db().from("customers").select("wa_id").eq("id", customerId).single(),
      db().from("conversations").select("id").eq("customer_id", customerId).single(),
    ]);
    const r = buttons ? await wa.buttons(cust.data!.wa_id, text, buttons) : await wa.text(cust.data!.wa_id, text);
    if (conv.data) await logOutbound(conv.data.id, r.messages?.[0]?.id, buttons ? "interactive" : "text", text);
  } catch (err) {
    console.error("[shipment] WhatsApp copy failed", err);
  }
}

/** Entry point for the calculator page and the AI agent. */
export function submitShipment(input: ShipmentInput): Promise<QuoteOk | FclOk | ShipErr> {
  if (input.kind === "air" || input.kind === "lcl") return createAndSendQuote(input);
  if (input.kind === "fcl") return createFclRequest(input);
  return Promise.resolve({ ok: false, error: "يرجى اختيار طريقة الشحن" });
}

/**
 * Air / LCL: validate → price with the engine → save → send the quote on WhatsApp with "proceed" buttons.
 */
export async function createAndSendQuote(input: ShipmentInput): Promise<QuoteOk | ShipErr> {
  const kind = input.kind as "air" | "lcl";
  const city = clean(input.city, 80);
  if (!city) return { ok: false, error: "يرجى تحديد مدينة التوصيل" };
  const items = await validateItems(input);
  if (typeof items === "string") return { ok: false, error: items };

  const mode = modeOf(kind);
  const [settings, surcharges, cities, rates] = await Promise.all([
    getShippingSettings(), getActiveSurcharges(mode), listMainCities(),
    getCurrentRates([...new Set(items.map((i) => i.category_key))], mode),
  ]);

  const priced: PricedItem[] = [];
  for (const it of items) {
    const rate = rates.get(it.category_key);
    if (!rate) return { ok: false, error: `الشحن ${kind === "air" ? "الجوي" : "البحري"} غير متاح لنوع «${it.category_ar}»` };
    priced.push({ ...it, rate });
  }

  const is_remote = isRemoteCity(city, cities);
  const b = computeQuote(kind, priced, { city, is_remote, fee_per_carton: settings.remote_fee_per_carton }, settings.mixed_pricing, surcharges, settings);
  const notes: Notes = { transit: transitFor(settings, kind), customs_notice: settings.customs_notice_ar };

  const valid_until = new Date(Date.now() + settings.quote_validity_days * 86_400_000).toISOString();
  const quote = await saveQuote({
    customer_id: input.customerId, kind, items, cbm: b.cbm, actual_kg: b.actual_kg, chargeable: b.chargeable,
    breakdown: b, subtotal: b.subtotal, vat_amount: b.vat_amount, total: b.total, valid_until, city, is_remote,
  });

  await sendWa(input.customerId, quoteMessage({ code: quote.code, valid_until, b, notes }), [
    { id: PROCEED(quote.id), title: "إكمال الطلب" },
    { id: AGAIN, title: "تسعيرة جديدة" },
  ]);

  const cust = await db().from("customers").select("registration_complete").eq("id", input.customerId).single();
  return {
    ok: true, type: "quote", quote: { id: quote.id, code: quote.code, valid_until }, b, notes,
    registered: Boolean(cust.data?.registration_complete), samples: settings.prices_are_samples,
  };
}

/**
 * Full container: no price — save the request, open a task for the team, confirm on WhatsApp.
 */
export async function createFclRequest(input: ShipmentInput): Promise<FclOk | ShipErr> {
  const options = await listContainerOptions();
  const containers = (input.containers ?? [])
    .map((c) => ({ key: String(c.key), count: Number(c.count) }))
    .filter((c) => c.count > 0);
  if (!containers.length) return { ok: false, error: "يرجى اختيار نوع الحاوية" };
  for (const c of containers) {
    if (!options.some((o) => o.key === c.key)) return { ok: false, error: "نوع الحاوية غير متاح" };
    if (!Number.isInteger(c.count) || c.count > LIMITS.maxContainers) return { ok: false, error: "عدد الحاويات غير صحيح" };
  }
  const port = String(input.port ?? "");
  if (!PORTS.some((p) => p.key === port)) return { ok: false, error: "يرجى اختيار ميناء الوصول" };
  const city = clean(input.city, 80);
  if (!city) return { ok: false, error: "يرجى كتابة مدينة الاستلام في السعودية" };
  const factory_address = clean(input.factory_address, LIMITS.maxText);
  if (factory_address.length < 5) return { ok: false, error: "يرجى كتابة عنوان المصنع في الصين" };
  const services = [...new Set((input.services ?? []).map(String))].filter((s) => FCL_SERVICES.some((x) => x.key === s));
  const notes = clean(input.notes, LIMITS.maxText) || undefined;

  const items = await validateItems(input);
  if (typeof items === "string") return { ok: false, error: items };

  const settings = await getShippingSettings();
  const total = measure(items.flatMap((i) => i.cartons), settings.air_volumetric_divisor);
  const named = containers.map((c) => ({ ...c, name_ar: options.find((o) => o.key === c.key)!.name_ar }));
  const breakdown = {
    kind: "fcl", ...total,
    items: items.map((i) => ({ category_ar: i.category_ar, product: i.product, ...measure(i.cartons, settings.air_volumetric_divisor) })),
    containers: named, port, city, factory_address, services,
  };

  const valid_until = new Date(Date.now() + settings.quote_validity_days * 86_400_000).toISOString();
  const q = await saveQuote({
    customer_id: input.customerId, kind: "fcl", items, cbm: total.cbm, actual_kg: total.actual_kg, chargeable: 0,
    breakdown, subtotal: null, vat_amount: null, total: null, valid_until, status: "requested",
    city, is_remote: false, containers, dest_port: port, factory_address, services, notes,
  });

  const cust = await db().from("customers").select("code, full_name, wa_id").eq("id", input.customerId).single();
  const who = cust.data?.full_name ?? cust.data?.code ?? "";
  await createTask({
    customer_id: input.customerId,
    type: "fcl_request",
    quote_id: q.id,
    title: [
      `طلب حاوية ${q.code} من ${who} (${cust.data?.wa_id ?? ""})`,
      named.map((c) => `${c.name_ar}×${c.count}`).join(" + "),
      `${portName(port)} ← ${city}`,
      services.length ? `خدمات: ${services.map(serviceName).join("، ")}` : "بدون خدمات إضافية",
    ].join(" — "),
  });
  await audit(input.customerId, "fcl.requested", "shipping_quotes", q.id, { code: q.code });

  await sendWa(input.customerId, fclRequestMessage({
    code: q.code, containers: named, port, city,
    items: items.map((i) => ({ product: i.product, category_ar: i.category_ar, cartons_count: measure(i.cartons, 6000).cartons_count })),
    services,
  }));

  return { ok: true, type: "fcl", code: q.code };
}
