import { db } from "../supabase";
import type { Carton, Kind, MixedPricing, Mode, Rate, Settings, Surcharge } from "./pricing";

export type ShippingSettings = Settings & {
  quote_validity_days: number;
  prices_are_samples: boolean;
  mixed_pricing: MixedPricing;
  remote_fee_per_carton: number | null;
  transit_air_ar: string;
  transit_sea_ar: string;
  customs_notice_ar: string;
};
export type CategoryOption = { key: string; name_ar: string; hint_ar: string | null; kinds: Kind[] };
export type ContainerOption = { key: string; name_ar: string; hint_ar: string | null };

const nowIso = () => new Date().toISOString();
const num = (v: unknown) => Number(v ?? 0);

export async function getShippingSettings(): Promise<ShippingSettings> {
  const r = await db().from("shipping_settings").select("*").eq("id", 1).single();
  if (r.error) throw r.error;
  const d = r.data;
  return {
    vat_rate: num(d.vat_rate),
    air_volumetric_divisor: num(d.air_volumetric_divisor),
    quote_validity_days: num(d.quote_validity_days),
    prices_are_samples: Boolean(d.prices_are_samples),
    mixed_pricing: d.mixed_pricing === "per_item" ? "per_item" : "highest",
    remote_fee_per_carton: d.remote_fee_per_carton === null || d.remote_fee_per_carton === undefined ? null : num(d.remote_fee_per_carton),
    transit_air_ar: d.transit_air_ar ?? "",
    transit_sea_ar: d.transit_sea_ar ?? "",
    customs_notice_ar: d.customs_notice_ar ?? "",
  };
}

export const transitFor = (s: ShippingSettings, kind: Kind) => (kind === "air" ? s.transit_air_ar : s.transit_sea_ar);

/** Active rows only: effective_from <= now < effective_to */
const currentRates = () =>
  db().from("shipping_rates").select("id, category_key, mode, unit_price, min_charge, min_qty, effective_from")
    .lte("effective_from", nowIso())
    .or(`effective_to.is.null,effective_to.gt.${nowIso()}`)
    .order("effective_from", { ascending: false });

/** Active categories + which kinds they can ship by (a category with no air price can't go by air). FCL takes any category. */
export async function listCategoryOptions(): Promise<CategoryOption[]> {
  const [cats, rates] = await Promise.all([
    db().from("shipping_categories").select("key, name_ar, hint_ar").eq("active", true).order("sort_order"),
    currentRates(),
  ]);
  if (cats.error) throw cats.error;
  if (rates.error) throw rates.error;
  return cats.data.map((c) => {
    const has = (m: Mode) => rates.data.some((r) => r.category_key === c.key && r.mode === m);
    const kinds: Kind[] = [];
    if (has("air")) kinds.push("air");
    if (has("sea")) kinds.push("lcl");
    kinds.push("fcl");
    return { ...c, kinds };
  });
}

/** Full-container types (no prices: FCL is quoted by the team). */
export async function listContainerOptions(): Promise<ContainerOption[]> {
  const r = await db().from("fcl_containers").select("key, name_ar, hint_ar").eq("active", true).order("sort_order");
  if (r.error) throw r.error;
  return r.data;
}

export async function listMainCities(): Promise<string[]> {
  const r = await db().from("shipping_cities").select("name_ar").order("sort_order").order("name_ar");
  if (r.error) throw r.error;
  return r.data.map((c) => c.name_ar);
}

/** Current rates for several categories at once. Missing key = not available for this mode. */
export async function getCurrentRates(categoryKeys: string[], mode: Mode): Promise<Map<string, Rate>> {
  const r = await currentRates().eq("mode", mode).in("category_key", categoryKeys);
  if (r.error) throw r.error;
  const m = new Map<string, Rate>();
  for (const x of r.data) { // newest first → keep the first per category
    if (!m.has(x.category_key)) m.set(x.category_key, { id: x.id, unit_price: num(x.unit_price), min_charge: num(x.min_charge), min_qty: num(x.min_qty) });
  }
  return m;
}

export async function getActiveSurcharges(mode: Mode): Promise<Surcharge[]> {
  const r = await db().from("shipping_surcharges").select("id, name_ar, kind, amount, mode")
    .eq("active", true)
    .lte("starts_at", nowIso())
    .or(`ends_at.is.null,ends_at.gt.${nowIso()}`);
  if (r.error) throw r.error;
  return r.data.filter((s) => s.mode === null || s.mode === mode).map((s) => ({ id: s.id, name_ar: s.name_ar, kind: s.kind, amount: num(s.amount) }));
}

export async function getCategoryNames(keys: string[]): Promise<Map<string, string>> {
  const r = await db().from("shipping_categories").select("key, name_ar").in("key", keys);
  if (r.error) throw r.error;
  return new Map(r.data.map((c) => [c.key, c.name_ar]));
}

export type StoredItem = { category_key: string; category_ar: string; product: string; cartons: Carton[]; photos: string[] };

export async function saveQuote(q: {
  customer_id: string; kind: Kind; items: StoredItem[];
  cbm: number; actual_kg: number; chargeable: number;
  breakdown: unknown; subtotal: number | null; vat_amount: number | null; total: number | null;
  valid_until: string; status?: "estimate" | "requested";
  city: string; is_remote: boolean;
  containers?: { key: string; count: number }[]; dest_port?: string; factory_address?: string; services?: string[]; notes?: string;
}) {
  const r = await db().from("shipping_quotes").insert({
    customer_id: q.customer_id, kind: q.kind, mode: q.kind === "air" ? "air" : "sea",
    category_key: q.items[0]?.category_key ?? null,
    cartons: q.items.flatMap((i) => i.cartons),
    photo_path: q.items[0]?.photos[0] ?? null,
    items: q.items, cbm: q.cbm, actual_kg: q.actual_kg, chargeable: q.chargeable,
    breakdown: q.breakdown, subtotal: q.subtotal, vat_amount: q.vat_amount, total: q.total,
    valid_until: q.valid_until, status: q.status ?? "estimate",
    city: q.city, is_remote: q.is_remote,
    containers: q.containers ?? null, dest_port: q.dest_port ?? null, factory_address: q.factory_address ?? null,
    services: q.services ?? null, notes: q.notes ?? null,
  }).select("id, code, valid_until").single();
  if (r.error) throw r.error;
  return r.data as { id: string; code: string; valid_until: string };
}

export async function getQuote(id: string) {
  const r = await db().from("shipping_quotes").select("*").eq("id", id).maybeSingle();
  if (r.error) throw r.error;
  return r.data;
}
