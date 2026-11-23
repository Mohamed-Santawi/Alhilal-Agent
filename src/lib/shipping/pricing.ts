/**
 * Shipping price engine — pure functions, no I/O, so every number is testable.
 * The LLM / bot never computes prices; it only displays what this returns.
 *
 * Three shipment kinds (client rules):
 *   air : per kg — chargeable = max(actual, volumetric), minimum 20 kg (min_qty on the rate)
 *   lcl : sea consolidated, per CBM — minimum 1 CBM (min_qty on the rate)
 *   fcl : full container (20ft / 40HQ / reefer) — price per container
 */

export type Kind = "air" | "lcl" | "fcl";
export type Mode = "sea" | "air";
export const modeOf = (k: Kind): Mode => (k === "air" ? "air" : "sea");

export type Carton = { qty: number; l: number; w: number; h: number; kg: number }; // cm, kg per carton
export type Rate = { id: string; unit_price: number; min_charge: number; min_qty: number };
export type Surcharge = { id: string; name_ar: string; kind: "percent" | "fixed"; amount: number };
export type Settings = { vat_rate: number; air_volumetric_divisor: number };
export type ContainerLine = { key: string; name_ar: string; count: number; price: number };

export type QuoteBreakdown = {
  kind: Kind;
  mode: Mode;
  // cartons (air / lcl)
  cartons_count: number;
  cbm: number;
  actual_kg: number;
  volumetric_kg: number;
  measured: number;          // CBM (lcl) or kg (air) before applying the minimum
  chargeable: number;        // after the minimum quantity
  unit: "CBM" | "kg" | "container";
  min_qty: number;
  min_qty_applied: boolean;
  rate: { id: string; unit_price: number; min_charge: number } | null;
  // containers (fcl)
  containers: (ContainerLine & { value: number })[];
  // money
  freight: number;
  min_charge_applied: boolean;
  surcharges: { id: string; name_ar: string; kind: "percent" | "fixed"; amount: number; value: number }[];
  subtotal: number;
  vat_rate: number;
  vat_amount: number;
  total: number;
};

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

export const LIMITS = { maxRows: 30, maxQty: 10_000, maxCm: 400, maxKg: 2_000, maxContainers: 50 };

/** Returns an Arabic error message, or null if the cartons are valid. */
export function validateCartons(cartons: Carton[]): string | null {
  if (!cartons.length) return "أضف كرتونة واحدة على الأقل";
  if (cartons.length > LIMITS.maxRows) return `أقصى عدد للأسطر ${LIMITS.maxRows}`;
  for (const [i, c] of cartons.entries()) {
    const n = i + 1;
    if (!Number.isInteger(c.qty) || c.qty < 1 || c.qty > LIMITS.maxQty) return `السطر ${n}: عدد الكراتين غير صحيح`;
    for (const d of [c.l, c.w, c.h]) if (!(d > 0 && d <= LIMITS.maxCm)) return `السطر ${n}: الأبعاد لازم تكون بين 1 و${LIMITS.maxCm} سم`;
    if (!(c.kg > 0 && c.kg <= LIMITS.maxKg)) return `السطر ${n}: الوزن لازم يكون أكبر من صفر`;
  }
  return null;
}

function applyMoney(freight: number, surcharges: Surcharge[], settings: Settings) {
  const sc = surcharges.map((s) => ({
    id: s.id, name_ar: s.name_ar, kind: s.kind, amount: s.amount,
    value: r2(s.kind === "percent" ? (freight * s.amount) / 100 : s.amount),
  }));
  const subtotal = r2(freight + sc.reduce((s, x) => s + x.value, 0));
  const vat_amount = r2((subtotal * settings.vat_rate) / 100);
  return { surcharges: sc, subtotal, vat_rate: settings.vat_rate, vat_amount, total: r2(subtotal + vat_amount) };
}

/** Air or LCL, priced from the cartons. */
export function computeQuote(kind: "air" | "lcl", cartons: Carton[], rate: Rate, surcharges: Surcharge[], settings: Settings): QuoteBreakdown {
  const cartons_count = cartons.reduce((s, c) => s + c.qty, 0);
  const cm3 = cartons.reduce((s, c) => s + c.qty * c.l * c.w * c.h, 0);
  const cbm = r3(cm3 / 1_000_000);
  const actual_kg = r2(cartons.reduce((s, c) => s + c.qty * c.kg, 0));
  const volumetric_kg = kind === "air" ? r2(cm3 / settings.air_volumetric_divisor) : 0;

  const measured = kind === "lcl" ? cbm : r2(Math.max(actual_kg, volumetric_kg));
  const chargeable = Math.max(measured, rate.min_qty);
  const raw = r2(chargeable * rate.unit_price);
  const freight = Math.max(raw, rate.min_charge);

  return {
    kind, mode: modeOf(kind), cartons_count, cbm, actual_kg, volumetric_kg,
    measured, chargeable, unit: kind === "lcl" ? "CBM" : "kg",
    min_qty: rate.min_qty, min_qty_applied: measured < rate.min_qty,
    rate: { id: rate.id, unit_price: rate.unit_price, min_charge: rate.min_charge },
    containers: [], freight, min_charge_applied: raw < rate.min_charge,
    ...applyMoney(freight, surcharges, settings),
  };
}

/** Full containers: price per container × count. */
export function computeFclQuote(lines: ContainerLine[], surcharges: Surcharge[], settings: Settings): QuoteBreakdown {
  const containers = lines.map((l) => ({ ...l, value: r2(l.count * l.price) }));
  const freight = r2(containers.reduce((s, c) => s + c.value, 0));
  const count = lines.reduce((s, l) => s + l.count, 0);
  return {
    kind: "fcl", mode: "sea", cartons_count: 0, cbm: 0, actual_kg: 0, volumetric_kg: 0,
    measured: count, chargeable: count, unit: "container", min_qty: 0, min_qty_applied: false, rate: null,
    containers, freight, min_charge_applied: false,
    ...applyMoney(freight, surcharges, settings),
  };
}

export const KIND_AR: Record<Kind, string> = { air: "جوي ✈️", lcl: "بحري مجمّع (LCL) 🚢", fcl: "حاوية كاملة (FCL) 📦" };
const sar = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** WhatsApp text for a quote. */
export function quoteMessage(q: { code: string; category: string; valid_until: string; b: QuoteBreakdown }) {
  const { b } = q;
  const freightLines =
    b.kind === "fcl"
      ? b.containers.map((c) => `${c.name_ar}: ${c.count} × ${sar(c.price)} = ${sar(c.value)} ريال`)
      : [
          `الكراتين: ${b.cartons_count} | الحجم: ${b.cbm.toFixed(3)} CBM | الوزن: ${b.actual_kg} كجم`,
          ...(b.kind === "air" ? [`الوزن المحتسب (الأكبر بين الفعلي والحجمي): ${b.measured} كجم`] : []),
          ...(b.min_qty_applied ? [`تم تطبيق الحد الأدنى: ${b.min_qty} ${b.unit === "CBM" ? "CBM" : "كجم"}`] : []),
          ``,
          b.min_charge_applied
            ? `سعر الشحن (الحد الأدنى): ${sar(b.freight)} ريال`
            : `سعر الشحن: ${b.kind === "lcl" ? `${b.chargeable.toFixed(3)} CBM` : `${b.chargeable} كجم`} × ${sar(b.rate!.unit_price)} = ${sar(b.freight)} ريال`,
        ];
  return [
    `🧾 *تسعيرة شحن مبدئية* — ${q.code}`,
    ``,
    `نوع البضاعة: ${q.category}`,
    `الشحن: ${KIND_AR[b.kind]}`,
    ...freightLines,
    ...b.surcharges.map((s) => `+ ${s.name_ar}${s.kind === "percent" ? ` (${s.amount}%)` : ""}: ${sar(s.value)} ريال`),
    `الإجمالي قبل الضريبة: ${sar(b.subtotal)} ريال`,
    `ضريبة القيمة المضافة ${b.vat_rate}%: ${sar(b.vat_amount)} ريال`,
    `*الإجمالي: ${sar(b.total)} ريال*`,
    ``,
    b.kind === "fcl"
      ? `⚠️ السعر مبدئي، ويتم تأكيده مع فريقنا قبل الدفع.`
      : `⚠️ السعر مبدئي، والنهائي حسب الوزن والحجم الفعلي في مستودعنا.`,
    `صالح حتى: ${new Date(q.valid_until).toLocaleDateString("en-GB", { timeZone: "Asia/Riyadh" })}`,
  ].join("\n");
}
