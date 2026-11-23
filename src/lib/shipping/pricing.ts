/**
 * Shipping price engine — pure functions, no I/O, so every number is testable.
 * The LLM / bot never computes prices; it only displays what this returns.
 */

export type Mode = "sea" | "air";
export type Carton = { qty: number; l: number; w: number; h: number; kg: number }; // cm, kg per carton
export type Rate = { id: string; unit_price: number; min_charge: number };
export type Surcharge = { id: string; name_ar: string; kind: "percent" | "fixed"; amount: number };
export type Settings = { vat_rate: number; air_volumetric_divisor: number };

export type QuoteBreakdown = {
  mode: Mode;
  cartons_count: number;
  cbm: number;               // total volume, m³ (3 dp)
  actual_kg: number;         // total real weight
  volumetric_kg: number;     // air only (0 for sea)
  chargeable: number;        // CBM for sea, kg for air
  unit: "CBM" | "kg";
  rate: { id: string; unit_price: number; min_charge: number };
  freight: number;           // chargeable × unit_price, min_charge applied
  min_charge_applied: boolean;
  surcharges: { id: string; name_ar: string; kind: "percent" | "fixed"; amount: number; value: number }[];
  subtotal: number;          // before VAT
  vat_rate: number;
  vat_amount: number;
  total: number;
};

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

export const LIMITS = { maxRows: 30, maxQty: 10_000, maxCm: 400, maxKg: 2_000 };

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

export function computeQuote(mode: Mode, cartons: Carton[], rate: Rate, surcharges: Surcharge[], settings: Settings): QuoteBreakdown {
  const cartons_count = cartons.reduce((s, c) => s + c.qty, 0);
  const cm3 = cartons.reduce((s, c) => s + c.qty * c.l * c.w * c.h, 0);
  const cbm = r3(cm3 / 1_000_000);
  const actual_kg = r2(cartons.reduce((s, c) => s + c.qty * c.kg, 0));
  const volumetric_kg = mode === "air" ? r2(cm3 / settings.air_volumetric_divisor) : 0;

  const chargeable = mode === "sea" ? cbm : r2(Math.max(actual_kg, volumetric_kg));
  const raw = r2(chargeable * rate.unit_price);
  const freight = Math.max(raw, rate.min_charge);

  const sc = surcharges.map((s) => ({
    id: s.id, name_ar: s.name_ar, kind: s.kind, amount: s.amount,
    value: r2(s.kind === "percent" ? (freight * s.amount) / 100 : s.amount),
  }));
  const subtotal = r2(freight + sc.reduce((s, x) => s + x.value, 0));
  const vat_amount = r2((subtotal * settings.vat_rate) / 100);

  return {
    mode, cartons_count, cbm, actual_kg, volumetric_kg, chargeable,
    unit: mode === "sea" ? "CBM" : "kg",
    rate: { id: rate.id, unit_price: rate.unit_price, min_charge: rate.min_charge },
    freight, min_charge_applied: raw < rate.min_charge,
    surcharges: sc, subtotal, vat_rate: settings.vat_rate, vat_amount, total: r2(subtotal + vat_amount),
  };
}

const sar = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** WhatsApp text for a quote. */
export function quoteMessage(q: { code: string; category: string; valid_until: string; b: QuoteBreakdown }) {
  const { b } = q;
  const modeAr = b.mode === "sea" ? "بحري 🚢" : "جوي ✈️";
  const qty = b.mode === "sea" ? `${b.cbm.toFixed(3)} CBM` : `${b.chargeable} كجم`;
  const lines = [
    `🧾 *تسعيرة شحن مبدئية* — ${q.code}`,
    ``,
    `نوع البضاعة: ${q.category}`,
    `الشحن: ${modeAr}`,
    `الكراتين: ${b.cartons_count} | الحجم: ${b.cbm.toFixed(3)} CBM | الوزن: ${b.actual_kg} كجم`,
    ...(b.mode === "air" ? [`الوزن المحتسب (الأكبر بين الفعلي والحجمي): ${b.chargeable} كجم`] : []),
    ``,
    b.min_charge_applied
      ? `سعر الشحن (الحد الأدنى): ${sar(b.freight)} ريال`
      : `سعر الشحن: ${qty} × ${sar(b.rate.unit_price)} = ${sar(b.freight)} ريال`,
    ...b.surcharges.map((s) => `+ ${s.name_ar}${s.kind === "percent" ? ` (${s.amount}%)` : ""}: ${sar(s.value)} ريال`),
    `الإجمالي قبل الضريبة: ${sar(b.subtotal)} ريال`,
    `ضريبة القيمة المضافة ${b.vat_rate}%: ${sar(b.vat_amount)} ريال`,
    `*الإجمالي: ${sar(b.total)} ريال*`,
    ``,
    `⚠️ السعر مبدئي، والنهائي حسب الوزن والحجم الفعلي في مستودعنا.`,
    `صالح حتى: ${new Date(q.valid_until).toLocaleDateString("en-GB", { timeZone: "Asia/Riyadh" })}`,
  ];
  return lines.join("\n");
}
