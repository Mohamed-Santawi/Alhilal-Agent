"use client";

import { useMemo, useState } from "react";
import type { Kind, QuoteBreakdown } from "@/lib/shipping/pricing";

type Category = { key: string; name_ar: string; hint_ar: string | null; kinds: Kind[] };
type Container = { key: string; name_ar: string; hint_ar: string | null; price: number | null };

const KINDS: { kind: Kind; label: string; sub: string }[] = [
  { kind: "air", label: "جوي ✈️", sub: "بالكيلو · أقل شي 20 كجم" },
  { kind: "lcl", label: "بحري مجمّع LCL 🚢", sub: "بالمتر المكعب · أقل شي 1 CBM" },
  { kind: "fcl", label: "حاوية كاملة FCL 📦", sub: "حاويات 20 و40 قدم، ومبرّدة" },
];
const KIND_LABEL: Record<Kind, string> = { air: "جوي ✈️", lcl: "بحري مجمّع (LCL) 🚢", fcl: "حاوية كاملة (FCL) 📦" };
type Row = { qty: string; l: string; w: string; h: string; kg: string };
type Result = { quote: { id: string; code: string; valid_until: string }; category: string; b: QuoteBreakdown; registered: boolean; samples: boolean };

const emptyRow: Row = { qty: "", l: "", w: "", h: "", kg: "" };
const latin = (s: string) => s.replace(/[٠-٩]/g, (c) => String("٠١٢٣٤٥٦٧٨٩".indexOf(c))).replace(/[٫,]/g, ".");
const n = (s: string) => Number(latin(s.trim()));
const sar = (x: number) => x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Shrinks big phone photos so the upload stays small (and under Vercel's request limit). */
async function resizeImage(file: File, max = 1600): Promise<Blob> {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((res) => canvas.toBlob((b) => res(b ?? file), "image/jpeg", 0.82));
}

export default function QuoteForm({ token, categories, containers, samples, divisor }: {
  token: string; categories: Category[]; containers: Container[]; samples: boolean; divisor: number;
}) {
  const [category, setCategory] = useState("");
  const [kind, setKind] = useState<Kind | "">("");
  const [rows, setRows] = useState<Row[]>([{ ...emptyRow }]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [photo, setPhoto] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [proceed, setProceed] = useState<"" | "sending" | "accepted">("");

  const cat = categories.find((c) => c.key === category);
  const setRow = (i: number, k: keyof Row) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: e.target.value } : r)));

  // Live totals while typing (the server recalculates everything)
  const totals = useMemo(() => {
    let count = 0, cm3 = 0, kg = 0;
    for (const r of rows) {
      const q = n(r.qty), l = n(r.l), w = n(r.w), h = n(r.h), k = n(r.kg);
      if (q > 0) { count += q; if (l > 0 && w > 0 && h > 0) cm3 += q * l * w * h; if (k > 0) kg += q * k; }
    }
    return { count, cbm: cm3 / 1e6, kg, vol: cm3 / divisor };
  }, [rows, divisor]);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setError("");
    if (!category) return setError("اختار نوع البضاعة");
    if (!kind) return setError("اختار طريقة الشحن");
    const fd = new FormData();
    fd.set("token", token); fd.set("category", category); fd.set("kind", kind);
    if (kind === "fcl") {
      const picked = Object.entries(counts).filter(([, c]) => c > 0).map(([key, count]) => ({ key, count }));
      if (!picked.length) return setError("اختار نوع الحاوية وعددها");
      fd.set("containers", JSON.stringify(picked));
    } else {
      const cartons = rows
        .filter((r) => Object.values(r).some((v) => v.trim()))
        .map((r) => ({ qty: n(r.qty), l: n(r.l), w: n(r.w), h: n(r.h), kg: n(r.kg) }));
      if (!cartons.length) return setError("أدخل بيانات الكراتين");
      if (cartons.some((c) => Object.values(c).some((v) => !(v > 0)))) return setError("املأ العدد والأبعاد والوزن في كل سطر");
      fd.set("cartons", JSON.stringify(cartons));
    }

    setBusy(true);
    try {
      if (photo) fd.set("photo", await resizeImage(photo), "photo.jpg");
      const res = await fetch("/api/quote", { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));
      if (res.ok) { setResult(json); window.scrollTo({ top: 0, behavior: "smooth" }); }
      else if (res.status === 410) setError("الرابط انتهى. ارجع للواتساب واطلب الحاسبة من القايمة.");
      else setError(json.error ?? "حصلت مشكلة، حاول مرة ثانية.");
    } catch {
      setError("حصلت مشكلة في الاتصال، حاول مرة ثانية.");
    } finally {
      setBusy(false);
    }
  }

  async function goOn() {
    if (!result) return;
    setProceed("sending");
    const res = await fetch("/api/quote/proceed", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, quote_id: result.quote.id }) });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.status === "register") { window.location.href = json.url; return; }
    if (res.ok && json.status === "accepted") { setProceed("accepted"); return; }
    setProceed("");
    setError(res.status === 410 ? "الرابط انتهى. ارجع للواتساب واضغط «كمّل الطلب» تحت التسعيرة." : "حصلت مشكلة، حاول مرة ثانية.");
  }

  // ---------------- Result ----------------
  if (result) {
    const b = result.b;
    return (
      <div className="space-y-5">
        {result.samples && <SampleBanner />}
        <div className="text-center">
          <p className="text-sm text-slate-500">تسعيرة مبدئية</p>
          <p className="font-bold text-[#0B1B3A]" dir="ltr">{result.quote.code}</p>
        </div>

        <div className="rounded-2xl bg-[#0B1B3A] p-5 text-center text-white">
          <p className="text-sm text-white/70">الإجمالي شامل الضريبة</p>
          <p className="mt-1 text-4xl font-extrabold text-[#E9C77B]">{sar(b.total)} <span className="text-lg">ريال</span></p>
          <p className="mt-2 text-sm text-white/70">{result.category} · {KIND_LABEL[b.kind]}</p>
        </div>

        <dl className="divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm">
          {b.kind === "fcl" ? (
            b.containers.map((c) => <Line key={c.key} k={`${c.name_ar} (${c.count} × ${sar(c.price)})`} v={`${sar(c.value)} ريال`} />)
          ) : (
            <>
              <Line k="عدد الكراتين" v={String(b.cartons_count)} />
              <Line k="الحجم" v={`${b.cbm.toFixed(3)} CBM`} />
              <Line k="الوزن الفعلي" v={`${b.actual_kg} كجم`} />
              {b.kind === "air" && <Line k="الوزن المحتسب" v={`${b.measured} كجم`} hint="الأكبر بين الفعلي والحجمي" />}
              {b.min_qty_applied && <Line k="الحد الأدنى للشحن" v={b.unit === "CBM" ? `${b.min_qty} CBM` : `${b.min_qty} كجم`} hint="الكمية أقل من الحد الأدنى" />}
              <Line
                k={b.min_charge_applied ? "سعر الشحن (الحد الأدنى)" : `سعر الشحن (${b.unit === "CBM" ? b.chargeable.toFixed(3) : b.chargeable} × ${sar(b.rate?.unit_price ?? 0)})`}
                v={`${sar(b.freight)} ريال`}
              />
            </>
          )}
          {b.surcharges.map((s) => <Line key={s.id} k={`${s.name_ar}${s.kind === "percent" ? ` (${s.amount}%)` : ""}`} v={`${sar(s.value)} ريال`} />)}
          <Line k="الإجمالي قبل الضريبة" v={`${sar(b.subtotal)} ريال`} />
          <Line k={`ضريبة القيمة المضافة ${b.vat_rate}%`} v={`${sar(b.vat_amount)} ريال`} />
        </dl>

        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm leading-7 text-amber-900">
          {b.kind === "fcl" ? "⚠️ السعر مبدئي، ويتم تأكيده مع فريقنا قبل الدفع." : "⚠️ السعر مبدئي، والنهائي حسب الوزن والحجم الفعلي في مستودعنا."}<br />
          صالح حتى: {new Date(result.quote.valid_until).toLocaleDateString("en-GB")}
        </p>
        <p className="text-center text-sm text-slate-500">📩 اتبعتلك نسخة من التسعيرة على الواتساب</p>

        {proceed === "accepted" ? (
          <div className="rounded-xl bg-emerald-50 px-4 py-4 text-center text-emerald-800">
            ✅ تم استلام طلبك، وفريقنا هيتواصل معاك خلال 24 ساعة.
          </div>
        ) : (
          <>
            {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-red-700">{error}</p>}
            <button onClick={goOn} disabled={proceed === "sending"} className={btnGold}>
              {proceed === "sending" ? "لحظة..." : result.registered ? "كمّل الطلب" : "كمّل الطلب (تسجيل البيانات)"}
            </button>
            <button onClick={() => { setResult(null); setError(""); }} className="w-full rounded-xl border-2 border-slate-200 py-3 font-bold text-slate-600">
              احسب تسعيرة ثانية
            </button>
          </>
        )}
      </div>
    );
  }

  // ---------------- Form ----------------
  return (
    <form onSubmit={submit} noValidate className="space-y-7">
      {samples && <SampleBanner />}
      <div className="text-center">
        <h2 className="text-xl font-bold text-[#0B1B3A]">🧮 حاسبة أسعار الشحن</h2>
        <p className="mt-1 text-sm text-slate-500">اعرف سعر شحنتك من الصين للسعودية فوراً، ومن غير تسجيل</p>
      </div>

      <Section n={1} title="نوع البضاعة">
        <div className="grid grid-cols-2 gap-3">
          {categories.map((c) => (
            <button type="button" key={c.key} onClick={() => { setCategory(c.key); if (kind && !c.kinds.includes(kind)) setKind(""); }}
              className={`rounded-xl border-2 px-3 py-3 text-right transition ${category === c.key ? "border-[#D4AF5A] bg-[#FBF6EA]" : "border-slate-200"}`}>
              <span className="block font-bold text-[#0B1B3A]">{c.name_ar}</span>
              {c.hint_ar && <span className="mt-0.5 block text-xs leading-5 text-slate-500">{c.hint_ar}</span>}
            </button>
          ))}
        </div>
      </Section>

      <Section n={2} title="طريقة الشحن">
        <div className="grid gap-3">
          {KINDS.map(({ kind: k, label, sub }) => {
            const disabled = !!cat && !cat.kinds.includes(k);
            return (
              <button type="button" key={k} disabled={disabled} onClick={() => setKind(k)}
                className={`flex items-center justify-between rounded-xl border-2 px-4 py-3 text-right transition disabled:opacity-40 ${kind === k ? "border-[#D4AF5A] bg-[#FBF6EA]" : "border-slate-200"}`}>
                <span className="font-bold text-[#0B1B3A]">{label}</span>
                <span className="text-xs text-slate-500">{disabled ? "غير متاح لهذا النوع" : sub}</span>
              </button>
            );
          })}
        </div>
      </Section>

      {kind === "fcl" && (
        <Section n={3} title="الحاويات" hint="اختار نوع الحاوية والعدد">
          <div className="space-y-3">
            {containers.map((c) => {
              const count = counts[c.key] ?? 0;
              const set = (v: number) => setCounts((p) => ({ ...p, [c.key]: Math.max(0, Math.min(50, v)) }));
              return (
                <div key={c.key} className={`flex items-center justify-between rounded-xl border-2 px-4 py-3 ${count > 0 ? "border-[#D4AF5A] bg-[#FBF6EA]" : "border-slate-200"} ${c.price === null ? "opacity-50" : ""}`}>
                  <div>
                    <p className="font-bold text-[#0B1B3A]">{c.name_ar}</p>
                    <p className="text-xs text-slate-500">
                      {c.price === null ? "السعر عند الطلب" : `${sar(c.price)} ريال / حاوية`}{c.hint_ar ? ` · ${c.hint_ar}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2" dir="ltr">
                    <button type="button" disabled={c.price === null || count === 0} onClick={() => set(count - 1)}
                      className="h-9 w-9 rounded-full border border-slate-300 text-lg font-bold disabled:opacity-30">−</button>
                    <span className="w-6 text-center font-bold">{count}</span>
                    <button type="button" disabled={c.price === null} onClick={() => set(count + 1)}
                      className="h-9 w-9 rounded-full bg-[#0B1B3A] text-lg font-bold text-[#E9C77B] disabled:opacity-30">+</button>
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {kind !== "fcl" && (
      <Section n={3} title="الكراتين" hint="من قائمة التعبئة اللي عندك من المصنع. لو في أكثر من مقاس أضف سطر لكل مقاس.">
        <div className="space-y-3">
          {rows.map((r, i) => (
            <div key={i} className="rounded-xl border border-slate-200 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-bold text-[#0B1B3A]">مقاس {i + 1}</span>
                {rows.length > 1 && (
                  <button type="button" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="text-sm text-red-600">حذف</button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Num label="عدد الكراتين" value={r.qty} onChange={setRow(i, "qty")} />
                <Num label="وزن الكرتونة (كجم)" value={r.kg} onChange={setRow(i, "kg")} decimal />
              </div>
              <p className="mt-2 mb-1 text-xs text-slate-500">مقاس الكرتونة بالسنتيمتر</p>
              <div className="grid grid-cols-3 gap-2">
                <Num label="الطول" value={r.l} onChange={setRow(i, "l")} decimal />
                <Num label="العرض" value={r.w} onChange={setRow(i, "w")} decimal />
                <Num label="الارتفاع" value={r.h} onChange={setRow(i, "h")} decimal />
              </div>
            </div>
          ))}
          <button type="button" onClick={() => setRows((rs) => [...rs, { ...emptyRow }])}
            className="w-full rounded-xl border-2 border-dashed border-[#D4AF5A] py-3 font-bold text-[#B8923B]">+ إضافة مقاس آخر</button>
        </div>
        {totals.count > 0 && (
          <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3 text-center text-sm">
            <div><p className="text-slate-500">الكراتين</p><p className="font-bold">{totals.count}</p></div>
            <div><p className="text-slate-500">الحجم</p><p className="font-bold" dir="ltr">{totals.cbm.toFixed(3)} CBM</p></div>
            <div><p className="text-slate-500">الوزن</p><p className="font-bold">{Math.round(totals.kg * 100) / 100} كجم</p></div>
          </div>
        )}
        {totals.count > 0 && kind === "lcl" && totals.cbm < 1 && (
          <p className="text-xs text-amber-700">الحجم أقل من 1 CBM، وهيتحسب على 1 CBM (الحد الأدنى للبحري المجمّع)</p>
        )}
        {totals.count > 0 && kind === "air" && Math.max(totals.kg, totals.vol) < 20 && (
          <p className="text-xs text-amber-700">الوزن أقل من 20 كجم، وهيتحسب على 20 كجم (الحد الأدنى للجوي)</p>
        )}
      </Section>

      )}

      <Section n={4} title="صورة المنتج" hint="اختياري — بتساعدنا نتأكد من نوع البضاعة">
        <label className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-slate-300 px-4 py-4">
          <span className="text-2xl">📷</span>
          <span className="text-slate-600">{photo ? photo.name : "اختار صورة"}</span>
          <input type="file" accept="image/*" className="sr-only" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
        </label>
      </Section>

      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-red-700">{error}</p>}
      <button type="submit" disabled={busy} className={btnGold}>{busy ? "جاري الحساب..." : "احسب السعر"}</button>
    </form>
  );
}

const btnGold = "w-full rounded-xl bg-gradient-to-l from-[#B8923B] to-[#E0BE6E] py-4 text-lg font-bold text-[#0B1B3A] shadow-lg transition active:scale-[0.99] disabled:opacity-60";

function SampleBanner() {
  return <p className="rounded-xl bg-blue-50 px-4 py-2 text-center text-sm text-blue-800">ℹ️ الأسعار المعروضة حالياً تجريبية</p>;
}

function Section({ n, title, hint, children }: { n: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-3 border-b border-slate-100 pb-2">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#0B1B3A] text-sm font-bold text-[#E9C77B]">{n}</span>
        <div>
          <h3 className="text-lg font-bold text-[#0B1B3A]">{title}</h3>
          {hint && <p className="text-xs leading-5 text-slate-500">{hint}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function Num({ label, value, onChange, decimal }: { label: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; decimal?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-slate-600">{label}</span>
      <input value={value} onChange={onChange} inputMode={decimal ? "decimal" : "numeric"} dir="ltr"
        className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-center text-base outline-none focus:border-[#D4AF5A] focus:ring-2 focus:ring-[#D4AF5A]/30" />
    </label>
  );
}

function Line({ k, v, hint }: { k: string; v: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <dt className="text-slate-600">{k}{hint && <span className="block text-xs text-slate-400">{hint}</span>}</dt>
      <dd className="font-bold text-[#0B1B3A] whitespace-nowrap">{v}</dd>
    </div>
  );
}
