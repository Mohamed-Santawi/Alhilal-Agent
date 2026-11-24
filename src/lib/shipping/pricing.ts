/**
 * Shipping price engine — pure functions, no I/O, so every number is testable.
 * The LLM / bot never computes prices; it only displays what this returns.
 *
 * Client rules (Nov 2026):
 *   air : per kg — chargeable = max(actual, volumetric = L×W×H / 6000), minimum 20 kg (min_qty on the rate)
 *   lcl : sea consolidated, door to door, per CBM — minimum 1 CBM (min_qty on the rate)
 *   fcl : full container — NOT priced here; it is a request handled by the team
 *   A shipment may hold several products (categories):
 *     highest  → the whole shipment at the most expensive category's rate (client default)
 *     per_item → each product at its own rate; a shortfall to the minimum is billed at the highest rate
 *   Remote city → local delivery fee per carton (if the admin set one).
 */

export type Kind = "air" | "lcl" | "fcl";
export type Mode = "sea" | "air";
export type MixedPricing = "highest" | "per_item";
export const modeOf = (k: Kind): Mode => (k === "air" ? "air" : "sea");

export type Carton = { qty: number; l: number; w: number; h: number; kg: number }; // cm, kg per carton
export type Rate = { id: string; unit_price: number; min_charge: number; min_qty: number };
export type Surcharge = { id: string; name_ar: string; kind: "percent" | "fixed"; amount: number };
export type Settings = { vat_rate: number; air_volumetric_divisor: number };

/** A product line in a shipment, with its category's current rate already resolved. */
export type PricedItem = { category_key: string; category_ar: string; product: string; cartons: Carton[]; rate: Rate };
export type Destination = { city: string; is_remote: boolean; fee_per_carton: number | null };

export type Measures = { cartons_count: number; cbm: number; actual_kg: number; volumetric_kg: number };

export type QuoteBreakdown = Measures & {
  kind: "air" | "lcl";
  mode: Mode;
  pricing: MixedPricing;
  items: (Measures & { category_key: string; category_ar: string; product: string; measured: number; unit_price: number; value: number | null })[];
  measured: number;          // CBM (lcl) or kg (air) before applying the minimum
  chargeable: number;        // after the minimum quantity
  unit: "CBM" | "kg";
  min_qty: number;
  min_qty_applied: boolean;
  rate: { id: string; unit_price: number; min_charge: number; category_ar: string }; // the highest rate in the shipment
  freight: number;
  min_charge_applied: boolean;
  surcharges: { id: string; name_ar: string; kind: "percent" | "fixed"; amount: number; value: number }[];
  remote: { city: string; is_remote: boolean; fee_per_carton: number | null; value: number; pending: boolean };
  subtotal: number;
  vat_rate: number;
  vat_amount: number;
  total: number;
};

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

export const LIMITS = { maxItems: 10, maxRows: 30, maxQty: 10_000, maxCm: 400, maxKg: 2_000, maxContainers: 50, maxPhotos: 3, maxText: 300 };

/** Returns an Arabic error message, or null if the cartons are valid. `label` prefixes errors (e.g. the product). */
export function validateCartons(cartons: Carton[], label = ""): string | null {
  const p = label ? `${label}: ` : "";
  if (!cartons.length) return `${p}أضف كرتونة واحدة على الأقل`;
  if (cartons.length > LIMITS.maxRows) return `${p}أقصى عدد للأسطر ${LIMITS.maxRows}`;
  for (const [i, c] of cartons.entries()) {
    const n = i + 1;
    if (!Number.isInteger(c.qty) || c.qty < 1 || c.qty > LIMITS.maxQty) return `${p}السطر ${n}: عدد الكراتين غير صحيح`;
    for (const d of [c.l, c.w, c.h]) if (!(d > 0 && d <= LIMITS.maxCm)) return `${p}السطر ${n}: يجب أن تكون الأبعاد بين 1 و${LIMITS.maxCm} سم`;
    if (!(c.kg > 0 && c.kg <= LIMITS.maxKg)) return `${p}السطر ${n}: يجب أن يكون الوزن أكبر من صفر`;
  }
  return null;
}

/** Size and weight of a set of cartons. Volumetric kg uses the air divisor (shown for any kind). */
export function measure(cartons: Carton[], divisor: number): Measures {
  const cm3 = cartons.reduce((s, c) => s + c.qty * c.l * c.w * c.h, 0);
  return {
    cartons_count: cartons.reduce((s, c) => s + c.qty, 0),
    cbm: r3(cm3 / 1_000_000),
    actual_kg: r2(cartons.reduce((s, c) => s + c.qty * c.kg, 0)),
    volumetric_kg: r2(cm3 / divisor),
  };
}

const measuredOf = (kind: "air" | "lcl", m: Measures) => (kind === "lcl" ? m.cbm : r2(Math.max(m.actual_kg, m.volumetric_kg)));

/** Air or LCL shipment with one or more products. */
export function computeQuote(
  kind: "air" | "lcl", items: PricedItem[], dest: Destination, pricing: MixedPricing,
  surcharges: Surcharge[], settings: Settings,
): QuoteBreakdown {
  if (!items.length) throw new Error("no items");
  const all = items.flatMap((i) => i.cartons);
  const total = measure(all, settings.air_volumetric_divisor);
  const top = items.reduce((a, b) => (b.rate.unit_price > a.rate.unit_price ? b : a));
  const min_qty = Math.max(...items.map((i) => i.rate.min_qty));
  const min_charge = Math.max(...items.map((i) => i.rate.min_charge));

  // Whole shipment measured together: air takes max(actual, volumetric) over ALL cartons
  const measured = measuredOf(kind, total);
  const chargeable = Math.max(measured, min_qty);

  const lines = items.map((i) => {
    const m = measure(i.cartons, settings.air_volumetric_divisor);
    const im = measuredOf(kind, m);
    return { category_key: i.category_key, category_ar: i.category_ar, product: i.product, ...m, measured: im, unit_price: i.rate.unit_price, value: null as number | null };
  });

  let raw: number;
  if (pricing === "highest" || items.length === 1) {
    raw = r2(chargeable * top.rate.unit_price);
  } else {
    // Each product at its own rate (by its share of the shipment's measured quantity)
    const sumParts = lines.reduce((s, l) => s + l.measured, 0) || 1;
    for (const l of lines) l.value = r2((l.measured / sumParts) * measured * l.unit_price);
    const shortfall = chargeable - measured;
    raw = r2(lines.reduce((s, l) => s + (l.value ?? 0), 0) + (shortfall > 0 ? shortfall * top.rate.unit_price : 0));
  }
  const freight = Math.max(raw, min_charge);

  const sc = surcharges.map((s) => ({
    id: s.id, name_ar: s.name_ar, kind: s.kind, amount: s.amount,
    value: r2(s.kind === "percent" ? (freight * s.amount) / 100 : s.amount),
  }));
  const remoteValue = dest.is_remote && dest.fee_per_carton ? r2(dest.fee_per_carton * total.cartons_count) : 0;
  const subtotal = r2(freight + sc.reduce((s, x) => s + x.value, 0) + remoteValue);
  const vat_amount = r2((subtotal * settings.vat_rate) / 100);

  return {
    kind, mode: modeOf(kind), pricing: items.length > 1 ? pricing : "highest", ...total, items: lines,
    measured, chargeable, unit: kind === "lcl" ? "CBM" : "kg",
    min_qty, min_qty_applied: measured < min_qty,
    rate: { id: top.rate.id, unit_price: top.rate.unit_price, min_charge, category_ar: top.category_ar },
    freight, min_charge_applied: raw < min_charge,
    surcharges: sc,
    remote: {
      city: dest.city, is_remote: dest.is_remote, fee_per_carton: dest.fee_per_carton,
      value: remoteValue, pending: dest.is_remote && !dest.fee_per_carton,
    },
    subtotal, vat_rate: settings.vat_rate, vat_amount, total: r2(subtotal + vat_amount),
  };
}

// ---------------------------------------------------------------------
// Cities: "main" list → anything else is remote
// ---------------------------------------------------------------------
export function normalizeCity(s: string) {
  return s.trim()
    .replace(/[ً-ْـ]/g, "")      // tashkeel + tatweel
    .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
    .replace(/^(مدينه|محافظه)\s+/, "")
    .replace(/\s+/g, "")
    .replace(/^ال/, "")
    .toLowerCase();
}
/** Empty list = the remote check is off. */
export function isRemoteCity(city: string, mainCities: string[]) {
  if (!mainCities.length || !city.trim()) return false;
  const c = normalizeCity(city);
  return !mainCities.some((m) => normalizeCity(m) === c);
}

// ---------------------------------------------------------------------
// FCL request options (fixed by the client)
// ---------------------------------------------------------------------
export const PORTS = [
  { key: "dammam", name_ar: "ميناء الدمام" },
  { key: "riyadh", name_ar: "الميناء الجاف بالرياض" },
  { key: "jeddah", name_ar: "ميناء جدة الإسلامي" },
] as const;
export const FCL_SERVICES = [
  { key: "customs", name_ar: "التخليص الجمركي" },
  { key: "certificates", name_ar: "استخراج الشهادات (سابر وغيرها)" },
  { key: "full", name_ar: "تولّي جميع الإجراءات نيابةً عنك" },
] as const;
export const portName = (k: string | null | undefined) => PORTS.find((p) => p.key === k)?.name_ar ?? k ?? "";
export const serviceName = (k: string) => FCL_SERVICES.find((s) => s.key === k)?.name_ar ?? k;

// ---------------------------------------------------------------------
// WhatsApp texts
// ---------------------------------------------------------------------
export const KIND_AR: Record<Kind, string> = { air: "جوي ✈️", lcl: "بحري جزئي LCL إلى الباب 🚢", fcl: "حاوية كاملة 📦" };
const sar = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyText = (b: QuoteBreakdown, v: number) => (b.unit === "CBM" ? `${v.toFixed(3)} CBM` : `${v} كجم`);

export type Notes = { transit: string; customs_notice: string };

/** WhatsApp text for an air/LCL quote. */
export function quoteMessage(q: { code: string; valid_until: string; b: QuoteBreakdown; notes: Notes }) {
  const { b } = q;
  const products = b.items.length === 1
    ? [`المنتج: ${b.items[0].product} (${b.items[0].category_ar})`]
    : [`المنتجات:`, ...b.items.map((i) => `• ${i.product} (${i.category_ar}) — ${i.cartons_count} كرتون`)];
  const freightLine = b.min_charge_applied
    ? `سعر الشحن (الحد الأدنى): ${sar(b.freight)} ريال`
    : b.pricing === "per_item"
      ? `سعر الشحن (كل منتج بسعر نوعه): ${sar(b.freight)} ريال`
      : `سعر الشحن: ${qtyText(b, b.chargeable)} × ${sar(b.rate.unit_price)} = ${sar(b.freight)} ريال`;

  return [
    `🧾 *تسعيرة شحن مبدئية* — ${q.code}`,
    ``,
    `الشحن: ${KIND_AR[b.kind]}`,
    ...products,
    `التوصيل إلى: ${b.remote.city}${b.remote.is_remote ? " (منطقة نائية)" : ""}`,
    `الكراتين: ${b.cartons_count} | الحجم: ${b.cbm.toFixed(3)} CBM | الوزن: ${b.actual_kg} كجم`,
    ...(b.kind === "air" ? [`الوزن المحتسب (الأعلى بين الفعلي ${b.actual_kg} والحجمي ${b.volumetric_kg}): ${b.measured} كجم`] : []),
    ...(b.min_qty_applied ? [`تم تطبيق الحد الأدنى: ${qtyText(b, b.min_qty)}`] : []),
    ...(b.items.length > 1 && b.pricing === "highest" ? [`(الشحنة محسوبة بسعر النوع الأعلى: ${b.rate.category_ar})`] : []),
    ``,
    freightLine,
    ...b.surcharges.map((s) => `+ ${s.name_ar}${s.kind === "percent" ? ` (${s.amount}%)` : ""}: ${sar(s.value)} ريال`),
    ...(b.remote.value ? [`+ التوصيل للمناطق النائية: ${b.cartons_count} كرتون × ${sar(b.remote.fee_per_carton!)} = ${sar(b.remote.value)} ريال`] : []),
    `الإجمالي قبل الضريبة: ${sar(b.subtotal)} ريال`,
    `ضريبة القيمة المضافة ${b.vat_rate}%: ${sar(b.vat_amount)} ريال`,
    `*الإجمالي: ${sar(b.total)} ريال*`,
    ``,
    `✅ السعر شامل التخليص والتوصيل من مستودعنا في الصين إلى بابك.`,
    ...(b.remote.pending ? [`📍 مدينتك خارج المناطق الرئيسية، وسيؤكد فريقنا رسوم التوصيل المحلي.`] : []),
    `⏱️ مدة الوصول: ${q.notes.transit}`,
    `⚠️ السعر مبدئي، والنهائي حسب الوزن والحجم الفعلي في مستودعنا. ${q.notes.customs_notice}`,
    `صالح حتى: ${new Date(q.valid_until).toLocaleDateString("en-GB", { timeZone: "Asia/Riyadh" })}`,
  ].join("\n");
}

/** WhatsApp text confirming a full-container request. */
export function fclRequestMessage(r: {
  code: string; containers: { name_ar: string; count: number }[]; port: string; city: string;
  items: { product: string; category_ar: string; cartons_count: number }[]; services: string[];
}) {
  return [
    `📦 *تم استلام طلب الحاوية* — ${r.code}`,
    ``,
    `الحاوية: ${r.containers.map((c) => `${c.name_ar} × ${c.count}`).join("، ")}`,
    `ميناء الوصول: ${portName(r.port)}`,
    `مدينة الاستلام: ${r.city}`,
    `المنتجات: ${r.items.map((i) => i.product).join("، ")}`,
    `الخدمات المطلوبة: ${r.services.length ? r.services.map(serviceName).join("، ") : "الشحن فقط"}`,
    ``,
    `سيتواصل معك أحد أعضاء فريقنا خلال 24 ساعة بعرض السعر والتفاصيل.`,
  ].join("\n");
}
