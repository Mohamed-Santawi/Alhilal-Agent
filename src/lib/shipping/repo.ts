import { db } from "../supabase";
import type { Carton, ContainerLine, Kind, Mode, QuoteBreakdown, Rate, Settings, Surcharge } from "./pricing";

export type ShippingSettings = Settings & { quote_validity_days: number; prices_are_samples: boolean };
export type CategoryOption = { key: string; name_ar: string; hint_ar: string | null; kinds: Kind[] };
export type ContainerOption = { key: string; name_ar: string; hint_ar: string | null; price: number | null };

const nowIso = () => new Date().toISOString();
const num = (v: unknown) => Number(v ?? 0);

export async function getShippingSettings(): Promise<ShippingSettings> {
  const r = await db().from("shipping_settings").select("*").eq("id", 1).single();
  if (r.error) throw r.error;
  return {
    vat_rate: num(r.data.vat_rate),
    air_volumetric_divisor: num(r.data.air_volumetric_divisor),
    quote_validity_days: num(r.data.quote_validity_days),
    prices_are_samples: Boolean(r.data.prices_are_samples),
  };
}

/** Active rows only: effective_from <= now < effective_to */
const currentRates = () =>
  db().from("shipping_rates").select("id, category_key, mode, unit_price, min_charge, min_qty, effective_from")
    .lte("effective_from", nowIso())
    .or(`effective_to.is.null,effective_to.gt.${nowIso()}`)
    .order("effective_from", { ascending: false });

/** Active categories + which modes currently have a price (a category with no air price can't be shipped by air). */
export async function listCategoryOptions(): Promise<CategoryOption[]> {
  const [cats, rates] = await Promise.all([
    db().from("shipping_categories").select("key, name_ar, hint_ar").eq("active", true).order("sort_order"),
    currentRates(),
  ]);
  if (cats.error) throw cats.error;
  if (rates.error) throw rates.error;
  const hasFcl = (await listContainerOptions()).some((c) => c.price !== null);
  return cats.data.map((c) => {
    const has = (m: Mode) => rates.data.some((r) => r.category_key === c.key && r.mode === m);
    const kinds: Kind[] = [];
    if (has("air")) kinds.push("air");
    if (has("sea")) kinds.push("lcl");
    if (hasFcl) kinds.push("fcl");
    return { ...c, kinds };
  });
}

/** Full-container types with their current price (null = no price set → "on request"). */
export async function listContainerOptions(): Promise<ContainerOption[]> {
  const [cs, rs] = await Promise.all([
    db().from("fcl_containers").select("key, name_ar, hint_ar").eq("active", true).order("sort_order"),
    db().from("fcl_rates").select("container_key, price, effective_from")
      .lte("effective_from", nowIso()).or(`effective_to.is.null,effective_to.gt.${nowIso()}`)
      .order("effective_from", { ascending: false }),
  ]);
  if (cs.error) throw cs.error;
  if (rs.error) throw rs.error;
  return cs.data.map((c) => {
    const r = rs.data.find((x) => x.container_key === c.key);
    return { ...c, price: r ? num(r.price) : null };
  });
}

/** Resolves requested containers to priced lines; returns an error if a type is unknown or has no price. */
export async function priceContainers(req: { key: string; count: number }[]): Promise<ContainerLine[] | string> {
  const opts = await listContainerOptions();
  const lines: ContainerLine[] = [];
  for (const r of req) {
    const o = opts.find((x) => x.key === r.key);
    if (!o) return "نوع الحاوية غير متاح";
    if (o.price === null) return `سعر ${o.name_ar} يحدده فريقنا، يرجى التحدث مع موظف من القائمة`;
    lines.push({ key: o.key, name_ar: o.name_ar, count: r.count, price: o.price });
  }
  return lines;
}

export async function getCurrentRate(categoryKey: string, mode: Mode): Promise<Rate | null> {
  const r = await currentRates().eq("category_key", categoryKey).eq("mode", mode).limit(1).maybeSingle();
  if (r.error) throw r.error;
  return r.data ? { id: r.data.id, unit_price: num(r.data.unit_price), min_charge: num(r.data.min_charge), min_qty: num(r.data.min_qty) } : null;
}

export async function getActiveSurcharges(mode: Mode): Promise<Surcharge[]> {
  const r = await db().from("shipping_surcharges").select("id, name_ar, kind, amount, mode")
    .eq("active", true)
    .lte("starts_at", nowIso())
    .or(`ends_at.is.null,ends_at.gt.${nowIso()}`);
  if (r.error) throw r.error;
  return r.data.filter((s) => s.mode === null || s.mode === mode).map((s) => ({ id: s.id, name_ar: s.name_ar, kind: s.kind, amount: num(s.amount) }));
}

export async function getCategoryName(key: string): Promise<string> {
  const r = await db().from("shipping_categories").select("name_ar").eq("key", key).single();
  return r.data?.name_ar ?? key;
}

export async function saveQuote(q: {
  customer_id: string; category_key: string; cartons: Carton[]; containers?: { key: string; count: number }[]; photo_path?: string | null;
  b: QuoteBreakdown; valid_until: string;
}) {
  const r = await db().from("shipping_quotes").insert({
    customer_id: q.customer_id, category_key: q.category_key, mode: q.b.mode, kind: q.b.kind, cartons: q.cartons,
    containers: q.containers ?? null,
    photo_path: q.photo_path ?? null, cbm: q.b.cbm, actual_kg: q.b.actual_kg, chargeable: q.b.chargeable,
    breakdown: q.b, subtotal: q.b.subtotal, vat_amount: q.b.vat_amount, total: q.b.total, valid_until: q.valid_until,
  }).select("id, code, valid_until").single();
  if (r.error) throw r.error;
  return r.data as { id: string; code: string; valid_until: string };
}

export async function getQuote(id: string) {
  const r = await db().from("shipping_quotes").select("*").eq("id", id).maybeSingle();
  if (r.error) throw r.error;
  return r.data;
}
