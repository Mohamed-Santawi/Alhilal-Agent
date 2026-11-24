"use client";

import { useMemo, useState } from "react";
import { FCL_SERVICES, PORTS, type Kind, type QuoteBreakdown } from "@/lib/shipping/pricing";

type Category = { key: string; name_ar: string; hint_ar: string | null; kinds: Kind[] };
type Container = { key: string; name_ar: string; hint_ar: string | null };
type Row = { qty: string; l: string; w: string; h: string; kg: string };
type Photo = { id: string; preview: string; path?: string; error?: string };
type Item = { id: string; category: string; product: string; rows: Row[]; photos: Photo[] };
type QuoteResult = { type: "quote"; quote: { id: string; code: string; valid_until: string }; b: QuoteBreakdown; notes: { transit: string; customs_notice: string }; registered: boolean; samples: boolean };
type FclResult = { type: "fcl"; code: string };
type StepKey = "method" | "products" | "destination" | "services" | "review";

const STEP_LABEL: Record<StepKey, string> = { method: "طريقة الشحن", products: "المنتجات", destination: "التوصيل", services: "الخدمات", review: "المراجعة" };
const KIND_LABEL: Record<Kind, string> = { air: "جوي ✈️", lcl: "بحري جزئي LCL إلى الباب 🚢", fcl: "حاوية كاملة 📦" };
const MAX_ITEMS = 10, MAX_PHOTOS = 3, OTHER = "__other__";

const emptyRow = (): Row => ({ qty: "", l: "", w: "", h: "", kg: "" });
const uid = () => Math.random().toString(36).slice(2, 10);
const newItem = (): Item => ({ id: uid(), category: "", product: "", rows: [emptyRow()], photos: [] });
const latin = (s: string) => s.replace(/[٠-٩]/g, (c) => String("٠١٢٣٤٥٦٧٨٩".indexOf(c))).replace(/[٫,]/g, ".");
const n = (s: string) => Number(latin(s.trim()));
const sar = (x: number) => x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = (x: number) => Math.round(x * 100) / 100;

/** Shrinks big phone photos so each upload stays small. */
async function resizeImage(file: File, max = 1400): Promise<Blob> {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((res) => canvas.toBlob((b) => res(b ?? file), "image/jpeg", 0.8));
}

function measure(rows: Row[], divisor: number) {
  let count = 0, cm3 = 0, kg = 0;
  for (const r of rows) {
    const q = n(r.qty), l = n(r.l), w = n(r.w), h = n(r.h), k = n(r.kg);
    if (q > 0) { count += q; if (l > 0 && w > 0 && h > 0) cm3 += q * l * w * h; if (k > 0) kg += q * k; }
  }
  return { count, cbm: cm3 / 1e6, kg: r2(kg), vol: r2(cm3 / divisor) };
}

export default function QuoteForm(props: {
  token: string; categories: Category[]; containers: Container[]; cities: string[];
  samples: boolean; divisor: number; remoteFee: number | null;
  transit: { air: string; sea: string }; customsNotice: string;
}) {
  const { token, categories, containers, cities, samples, divisor, remoteFee, transit, customsNotice } = props;

  const [step, setStep] = useState<StepKey>("method");
  const [method, setMethod] = useState<"" | "air" | "sea">("");
  const [kind, setKind] = useState<Kind | "">("");
  const [container, setContainer] = useState("");
  const [count, setCount] = useState(1);
  const [items, setItems] = useState<Item[]>([newItem()]);
  const [cityPick, setCityPick] = useState("");
  const [cityOther, setCityOther] = useState("");
  const [port, setPort] = useState("");
  const [factory, setFactory] = useState("");
  const [services, setServices] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<QuoteResult | FclResult | null>(null);
  const [proceed, setProceed] = useState<"" | "sending" | "accepted">("");

  const steps: StepKey[] = kind === "fcl" ? ["method", "products", "destination", "services", "review"] : ["method", "products", "destination", "review"];
  const idx = steps.indexOf(step);
  const city = cities.length ? (cityPick === OTHER ? cityOther.trim() : cityPick) : cityOther.trim();
  const remote = !!cities.length && cityPick === OTHER && !!cityOther.trim();
  const catName = (k: string) => categories.find((c) => c.key === k)?.name_ar ?? "";
  const usable = categories.filter((c) => !kind || c.kinds.includes(kind));

  const totals = useMemo(() => measure(items.flatMap((i) => i.rows), divisor), [items, divisor]);

  // ---------- item helpers ----------
  const patchItem = (id: string, p: Partial<Item> | ((it: Item) => Partial<Item>)) =>
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...(typeof p === "function" ? p(x) : p) } : x)));
  const setRow = (id: string, i: number, k: keyof Row, v: string) =>
    patchItem(id, (it) => ({ rows: it.rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)) }));

  async function addPhotos(id: string, files: FileList | null) {
    if (!files?.length) return;
    const item = items.find((x) => x.id === id)!;
    const room = MAX_PHOTOS - item.photos.length;
    for (const file of Array.from(files).slice(0, room)) {
      const ph: Photo = { id: uid(), preview: URL.createObjectURL(file) };
      patchItem(id, (it) => ({ photos: [...it.photos, ph] }));
      try {
        const fd = new FormData();
        fd.set("token", token);
        fd.set("photo", await resizeImage(file), "photo.jpg");
        const res = await fetch("/api/quote/photo", { method: "POST", body: fd });
        const json = await res.json().catch(() => ({}));
        const upd = res.ok ? { path: json.path as string } : { error: res.status === 410 ? "انتهت صلاحية الرابط" : json.error ?? "تعذّر الرفع" };
        patchItem(id, (it) => ({ photos: it.photos.map((p) => (p.id === ph.id ? { ...p, ...upd } : p)) }));
      } catch {
        patchItem(id, (it) => ({ photos: it.photos.map((p) => (p.id === ph.id ? { ...p, error: "تعذّر الرفع" } : p)) }));
      }
    }
  }

  // ---------- step validation ----------
  function check(s: StepKey): string {
    if (s === "method") {
      if (!kind) return "يرجى اختيار طريقة الشحن";
      if (kind === "fcl" && !container) return "يرجى اختيار نوع الحاوية";
    }
    if (s === "products") {
      for (const [i, it] of items.entries()) {
        const p = items.length > 1 ? `المنتج ${i + 1}: ` : "";
        if (!it.category) return `${p}يرجى اختيار نوع البضاعة`;
        if (kind && !usable.some((c) => c.key === it.category)) return `${p}هذا النوع غير متاح لطريقة الشحن المختارة`;
        if (!it.product.trim()) return `${p}يرجى كتابة اسم المنتج`;
        if (!it.photos.length) return `${p}يرجى إرفاق صورة واحدة على الأقل`;
        if (it.photos.some((ph) => !ph.path && !ph.error)) return "يرجى الانتظار حتى يكتمل رفع الصور";
        if (it.photos.some((ph) => ph.error)) return `${p}احذف الصورة التي لم تُرفع ثم أعد المحاولة`;
        for (const [j, r] of it.rows.entries()) {
          if ([r.qty, r.l, r.w, r.h, r.kg].some((v) => !(n(v) > 0))) return `${p}املأ العدد والأبعاد والوزن في المقاس ${j + 1}`;
        }
      }
    }
    if (s === "destination") {
      if (kind === "fcl" && !port) return "يرجى اختيار ميناء الوصول";
      if (!city) return kind === "fcl" ? "يرجى تحديد مدينة الاستلام" : "يرجى تحديد مدينة التوصيل";
      if (kind === "fcl" && factory.trim().length < 5) return "يرجى كتابة عنوان المصنع في الصين";
    }
    return "";
  }
  function next() {
    const e = check(step);
    setError(e);
    if (!e) { setStep(steps[idx + 1]); window.scrollTo({ top: 0, behavior: "smooth" }); }
  }
  function back() { setError(""); setStep(steps[idx - 1]); }

  async function submit() {
    for (const s of steps.slice(0, -1)) { const e = check(s); if (e) { setStep(s); setError(e); return; } }
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/quote", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token, kind, city,
          items: items.map((it) => ({
            category: it.category, product: it.product.trim(),
            cartons: it.rows.map((r) => ({ qty: n(r.qty), l: n(r.l), w: n(r.w), h: n(r.h), kg: n(r.kg) })),
            photos: it.photos.map((p) => p.path).filter(Boolean),
          })),
          ...(kind === "fcl" ? { containers: [{ key: container, count }], port, factory_address: factory.trim(), services, notes: notes.trim() } : {}),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) { setResult(json); window.scrollTo({ top: 0, behavior: "smooth" }); }
      else if (res.status === 410) setError("انتهت صلاحية الرابط. يرجى العودة إلى الواتساب وطلب الحاسبة من القائمة.");
      else setError(json.error ?? "حدثت مشكلة، يرجى المحاولة مرة أخرى.");
    } catch {
      setError("حدثت مشكلة في الاتصال، يرجى المحاولة مرة أخرى.");
    } finally {
      setBusy(false);
    }
  }

  async function goOn(quoteId: string) {
    setProceed("sending");
    const res = await fetch("/api/quote/proceed", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, quote_id: quoteId }) });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.status === "register") { window.location.href = json.url; return; }
    if (res.ok && json.status === "accepted") { setProceed("accepted"); return; }
    setProceed("");
    setError(res.status === 410 ? "انتهت صلاحية الرابط. يرجى العودة إلى الواتساب والضغط على «إكمال الطلب» أسفل التسعيرة." : "حدثت مشكلة، يرجى المحاولة مرة أخرى.");
  }

  function restart() {
    setResult(null); setError(""); setProceed(""); setStep("method");
    setItems([newItem()]); setServices([]); setNotes("");
  }

  // =================== Results ===================
  if (result?.type === "fcl") {
    return (
      <div className="space-y-5 py-4 text-center">
        <div className="text-5xl">📦</div>
        <h2 className="text-xl font-bold text-[#0B1B3A]">تم استلام طلب الحاوية</h2>
        <p className="font-bold text-[#B8923B]" dir="ltr">{result.code}</p>
        <p className="leading-8 text-slate-600">سيتواصل معك أحد أعضاء فريقنا خلال 24 ساعة بعرض السعر والتفاصيل.<br />📩 أُرسلت نسخة من الطلب إلى الواتساب.</p>
        <button onClick={restart} className={btnGhost}>طلب جديد</button>
      </div>
    );
  }

  if (result?.type === "quote") {
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
          <p className="mt-2 text-sm text-white/70">{KIND_LABEL[b.kind]} · إلى {b.remote.city}</p>
        </div>

        <dl className="divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm">
          {b.items.map((i, k) => <Line key={k} k={`${i.product} (${i.category_ar})`} v={`الكراتين: ${i.cartons_count}`} />)}
          <Line k="الحجم" v={`${b.cbm.toFixed(3)} CBM`} />
          <Line k="الوزن الفعلي" v={`${b.actual_kg} كجم`} />
          {b.kind === "air" && <Line k="الوزن الحجمي" v={`${b.volumetric_kg} كجم`} hint={`الطول × العرض × الارتفاع ÷ ${divisor}`} />}
          {b.kind === "air" && <Line k="الوزن المحتسب" v={`${b.measured} كجم`} hint="الأعلى بين الفعلي والحجمي" />}
          {b.min_qty_applied && <Line k="الحد الأدنى للشحن" v={b.unit === "CBM" ? `${b.min_qty} CBM` : `${b.min_qty} كجم`} hint="الكمية أقل من الحد الأدنى" />}
          <Line
            k={b.min_charge_applied ? "سعر الشحن (الحد الأدنى)" : b.pricing === "per_item" ? "سعر الشحن (كل منتج بسعر نوعه)" : `سعر الشحن (${b.unit === "CBM" ? b.chargeable.toFixed(3) : b.chargeable} × ${sar(b.rate.unit_price)})`}
            hint={b.items.length > 1 && b.pricing === "highest" ? `محسوب بسعر النوع الأعلى: ${b.rate.category_ar}` : undefined}
            v={`${sar(b.freight)} ريال`}
          />
          {b.surcharges.map((s) => <Line key={s.id} k={`${s.name_ar}${s.kind === "percent" ? ` (${s.amount}%)` : ""}`} v={`${sar(s.value)} ريال`} />)}
          {b.remote.value > 0 && <Line k="التوصيل للمناطق النائية" hint={`${b.cartons_count} × ${sar(b.remote.fee_per_carton!)} ريال لكل كرتونة`} v={`${sar(b.remote.value)} ريال`} />}
          <Line k="الإجمالي قبل الضريبة" v={`${sar(b.subtotal)} ريال`} />
          <Line k={`ضريبة القيمة المضافة ${b.vat_rate}%`} v={`${sar(b.vat_amount)} ريال`} />
        </dl>

        <div className="space-y-2 rounded-xl bg-slate-50 px-4 py-3 text-sm leading-7 text-slate-700">
          <p>✅ السعر شامل التخليص والتوصيل من مستودعنا في الصين إلى بابك.</p>
          {b.remote.pending && <p>📍 مدينتك خارج المناطق الرئيسية، وسيؤكد فريقنا رسوم التوصيل المحلي.</p>}
          <p>⏱️ مدة الوصول: {result.notes.transit}</p>
        </div>
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm leading-7 text-amber-900">
          ⚠️ السعر مبدئي، والنهائي حسب الوزن والحجم الفعلي في مستودعنا. {result.notes.customs_notice}<br />
          صالح حتى: {new Date(result.quote.valid_until).toLocaleDateString("en-GB")}
        </p>
        <p className="text-center text-sm text-slate-500">📩 أُرسلت نسخة من التسعيرة إلى الواتساب</p>

        {proceed === "accepted" ? (
          <div className="rounded-xl bg-emerald-50 px-4 py-4 text-center text-emerald-800">✅ تم استلام طلبك، وسيتواصل معك فريقنا خلال 24 ساعة.</div>
        ) : (
          <>
            {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-red-700">{error}</p>}
            <button onClick={() => goOn(result.quote.id)} disabled={proceed === "sending"} className={btnGold}>
              {proceed === "sending" ? "يرجى الانتظار..." : result.registered ? "إكمال الطلب" : "إكمال الطلب (تسجيل البيانات)"}
            </button>
            <button onClick={restart} className={btnGhost}>حساب تسعيرة أخرى</button>
          </>
        )}
      </div>
    );
  }

  // =================== Wizard ===================
  return (
    <div className="space-y-6">
      {samples && kind !== "fcl" && <SampleBanner />}
      <div className="text-center">
        <h2 className="text-xl font-bold text-[#0B1B3A]">🧮 حاسبة أسعار الشحن</h2>
        <p className="mt-1 text-sm text-slate-500">من الصين إلى باب منزلك في السعودية</p>
      </div>

      <Stepper steps={steps} current={idx} />

      {/* ---------- 1. Method ---------- */}
      {step === "method" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {([["air", "✈️", "شحن جوي", transit.air], ["sea", "🚢", "شحن بحري", transit.sea]] as const).map(([m, icon, label, t]) => (
              <button key={m} type="button" onClick={() => { setMethod(m); setKind(m === "air" ? "air" : ""); setContainer(""); }}
                className={`${card(method === m)} flex flex-col items-center gap-1 py-5`}>
                <span className="text-3xl">{icon}</span>
                <span className="font-bold text-[#0B1B3A]">{label}</span>
                <span className="text-center text-xs leading-5 text-slate-500">{t}</span>
              </button>
            ))}
          </div>

          {method === "air" && (
            <Info>يُحسب بالكيلو على أساس الأعلى بين الوزن الفعلي والوزن الحجمي (الطول × العرض × الارتفاع ÷ {divisor})، والحد الأدنى 20 كجم. السعر شامل التخليص والتوصيل إلى الباب.</Info>
          )}

          {method === "sea" && (
            <div className="grid gap-3">
              <button type="button" onClick={() => { setKind("lcl"); setContainer(""); }} className={`${card(kind === "lcl")} text-right`}>
                <span className="block font-bold text-[#0B1B3A]">شحن جزئي LCL إلى الباب</span>
                <span className="mt-0.5 block text-xs leading-5 text-slate-500">بالمتر المكعب · الحد الأدنى 1 CBM · شامل التخليص والتوصيل · سعر فوري</span>
              </button>
              {containers.map((c) => (
                <button key={c.key} type="button" onClick={() => { setKind("fcl"); setContainer(c.key); }} className={`${card(kind === "fcl" && container === c.key)} text-right`}>
                  <span className="block font-bold text-[#0B1B3A]">{c.name_ar}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-slate-500">{c.hint_ar ? `${c.hint_ar} · ` : ""}حاوية كاملة · يرسل لك فريقنا عرض السعر خلال 24 ساعة</span>
                </button>
              ))}
              {kind === "fcl" && (
                <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
                  <span className="font-bold text-[#0B1B3A]">عدد الحاويات</span>
                  <div className="flex items-center gap-2" dir="ltr">
                    <button type="button" disabled={count <= 1} onClick={() => setCount((c) => c - 1)} className="h-9 w-9 rounded-full border border-slate-300 text-lg font-bold disabled:opacity-30">−</button>
                    <span className="w-6 text-center font-bold">{count}</span>
                    <button type="button" disabled={count >= 50} onClick={() => setCount((c) => c + 1)} className="h-9 w-9 rounded-full bg-[#0B1B3A] text-lg font-bold text-[#E9C77B] disabled:opacity-30">+</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ---------- 2. Products ---------- */}
      {step === "products" && (
        <div className="space-y-4">
          <p className="text-sm leading-6 text-slate-500">أدخل بيانات كل منتج من قائمة التعبئة الواردة من المصنع. يمكنك إضافة أكثر من منتج في الشحنة نفسها.</p>
          {items.map((it, i) => (
            <div key={it.id} className="space-y-3 rounded-2xl border-2 border-slate-200 p-4">
              <div className="flex items-center justify-between">
                <span className="font-bold text-[#0B1B3A]">المنتج {i + 1}</span>
                {items.length > 1 && <button type="button" onClick={() => setItems((xs) => xs.filter((x) => x.id !== it.id))} className="text-sm text-red-600">حذف المنتج</button>}
              </div>

              <label className="block">
                <span className="mb-1 block text-sm text-slate-600">نوع البضاعة</span>
                <select value={it.category} onChange={(e) => patchItem(it.id, { category: e.target.value })} className={input}>
                  <option value="">اختر النوع</option>
                  {usable.map((c) => <option key={c.key} value={c.key}>{c.name_ar}{c.hint_ar ? ` — ${c.hint_ar}` : ""}</option>)}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-sm text-slate-600">اسم المنتج</span>
                <input value={it.product} maxLength={120} onChange={(e) => patchItem(it.id, { product: e.target.value })} placeholder="مثال: سماعات بلوتوث" className={input} />
              </label>

              <div>
                <span className="mb-1 block text-sm text-slate-600">صور المنتج <span className="text-xs text-slate-400">(إلزامية، حتى {MAX_PHOTOS} صور)</span></span>
                <div className="flex flex-wrap gap-2">
                  {it.photos.map((ph) => (
                    <div key={ph.id} className="relative h-20 w-20 overflow-hidden rounded-lg border border-slate-200">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={ph.preview} alt="" className={`h-full w-full object-cover ${ph.path ? "" : "opacity-50"}`} />
                      {!ph.path && !ph.error && <span className="absolute inset-0 grid place-items-center text-xs font-bold text-[#0B1B3A]">جاري الرفع…</span>}
                      {ph.error && <span className="absolute inset-0 grid place-items-center bg-red-50/80 p-1 text-center text-[10px] text-red-700">{ph.error}</span>}
                      <button type="button" onClick={() => patchItem(it.id, (x) => ({ photos: x.photos.filter((p) => p.id !== ph.id) }))}
                        className="absolute left-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-xs text-white">✕</button>
                    </div>
                  ))}
                  {it.photos.length < MAX_PHOTOS && (
                    <label className="grid h-20 w-20 cursor-pointer place-items-center rounded-lg border-2 border-dashed border-slate-300 text-2xl text-slate-400">
                      📷
                      <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => { addPhotos(it.id, e.target.files); e.target.value = ""; }} />
                    </label>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <span className="block text-sm text-slate-600">الكراتين <span className="text-xs text-slate-400">(إذا اختلفت المقاسات أضف مقاساً آخر)</span></span>
                {it.rows.map((r, j) => (
                  <div key={j} className="rounded-xl bg-slate-50 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-500">مقاس {j + 1}</span>
                      {it.rows.length > 1 && <button type="button" onClick={() => patchItem(it.id, (x) => ({ rows: x.rows.filter((_, k) => k !== j) }))} className="text-xs text-red-600">حذف</button>}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Num label="عدد الكراتين" value={r.qty} onChange={(v) => setRow(it.id, j, "qty", v)} />
                      <Num label="وزن الكرتونة (كجم)" value={r.kg} onChange={(v) => setRow(it.id, j, "kg", v)} decimal />
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      <Num label="الطول (سم)" value={r.l} onChange={(v) => setRow(it.id, j, "l", v)} decimal />
                      <Num label="العرض (سم)" value={r.w} onChange={(v) => setRow(it.id, j, "w", v)} decimal />
                      <Num label="الارتفاع (سم)" value={r.h} onChange={(v) => setRow(it.id, j, "h", v)} decimal />
                    </div>
                  </div>
                ))}
                <button type="button" onClick={() => patchItem(it.id, (x) => ({ rows: [...x.rows, emptyRow()] }))} className="text-sm font-bold text-[#B8923B]">+ إضافة مقاس آخر</button>
              </div>
            </div>
          ))}

          {items.length < MAX_ITEMS && (
            <button type="button" onClick={() => setItems((xs) => [...xs, newItem()])}
              className="w-full rounded-xl border-2 border-dashed border-[#D4AF5A] py-3 font-bold text-[#B8923B]">+ إضافة منتج آخر</button>
          )}

          {totals.count > 0 && <Totals t={totals} kind={kind} />}
        </div>
      )}

      {/* ---------- 3. Destination ---------- */}
      {step === "destination" && (
        <div className="space-y-4">
          {kind === "fcl" && (
            <div>
              <span className="mb-2 block text-sm text-slate-600">ميناء الوصول في السعودية</span>
              <div className="grid gap-2">
                {PORTS.map((p) => (
                  <button key={p.key} type="button" onClick={() => setPort(p.key)} className={`${card(port === p.key)} text-right font-bold text-[#0B1B3A]`}>{p.name_ar}</button>
                ))}
              </div>
            </div>
          )}

          <div>
            <span className="mb-1 block text-sm text-slate-600">{kind === "fcl" ? "المدينة التي ستستلم فيها البضاعة (مصنع، مستودع، منزل…)" : "مدينة التوصيل"}</span>
            {cities.length > 0 ? (
              <>
                <select value={cityPick} onChange={(e) => setCityPick(e.target.value)} className={input}>
                  <option value="">اختر المدينة</option>
                  {cities.map((c) => <option key={c} value={c}>{c}</option>)}
                  <option value={OTHER}>مدينة أخرى…</option>
                </select>
                {cityPick === OTHER && (
                  <input value={cityOther} onChange={(e) => setCityOther(e.target.value)} maxLength={80} placeholder="اكتب اسم المدينة" className={`${input} mt-2`} />
                )}
                {kind !== "fcl" && remote && (
                  <p className="mt-2 text-xs leading-5 text-amber-700">
                    هذه المدينة خارج المناطق الرئيسية، وتُضاف رسوم توصيل محلي {remoteFee ? `${sar(remoteFee)} ريال لكل كرتونة` : "يحددها فريقنا"}.
                  </p>
                )}
              </>
            ) : (
              <input value={cityOther} onChange={(e) => setCityOther(e.target.value)} maxLength={80} placeholder="مثال: الرياض" className={input} />
            )}
          </div>

          {kind === "fcl" && (
            <label className="block">
              <span className="mb-1 block text-sm text-slate-600">عنوان المصنع في الصين (مكان تحميل الحاوية)</span>
              <textarea value={factory} onChange={(e) => setFactory(e.target.value)} maxLength={300} rows={3}
                placeholder="المدينة والمنطقة واسم المصنع إن وُجد" className={input} />
              <span className="mt-1 block text-xs text-slate-400">نحتاجه لتحديد أقرب ميناء وحجز الحاوية.</span>
            </label>
          )}

          {kind !== "fcl" && <Info>⏱️ مدة الوصول: {kind === "air" ? transit.air : transit.sea}</Info>}
        </div>
      )}

      {/* ---------- 4. Services (FCL) ---------- */}
      {step === "services" && (
        <div className="space-y-3">
          <p className="text-sm leading-6 text-slate-500">اختر الخدمات التي تحتاجها مع الحاوية (اختياري). إذا كان لديك مخلّص خاص فلا تخترها.</p>
          {FCL_SERVICES.map((s) => {
            const on = services.includes(s.key);
            return (
              <button key={s.key} type="button" onClick={() => setServices((xs) => (on ? xs.filter((x) => x !== s.key) : [...xs, s.key]))}
                className={`${card(on)} flex w-full items-center justify-between text-right`}>
                <span className="font-bold text-[#0B1B3A]">{s.name_ar}</span>
                <span className={`grid h-6 w-6 place-items-center rounded-md border-2 ${on ? "border-[#B8923B] bg-[#D4AF5A] text-white" : "border-slate-300"}`}>{on ? "✓" : ""}</span>
              </button>
            );
          })}
          <label className="block pt-2">
            <span className="mb-1 block text-sm text-slate-600">ملاحظات (اختياري)</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} rows={3} className={input} />
          </label>
        </div>
      )}

      {/* ---------- 5. Review ---------- */}
      {step === "review" && (
        <div className="space-y-4">
          <dl className="divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm">
            <Line k="طريقة الشحن" v={kind === "fcl" ? `${containers.find((c) => c.key === container)?.name_ar} × ${count}` : KIND_LABEL[kind as Kind]} />
            {items.map((it, i) => (
              <Line key={it.id} k={`${i + 1}. ${it.product}`} hint={catName(it.category)} v={`الكراتين: ${measure(it.rows, divisor).count} · الصور: ${it.photos.length}`} />
            ))}
            <Line k="الحجم / الوزن" v={`${totals.cbm.toFixed(3)} CBM · ${totals.kg} كجم`} />
            {kind === "fcl" && <Line k="ميناء الوصول" v={PORTS.find((p) => p.key === port)?.name_ar ?? ""} />}
            <Line k={kind === "fcl" ? "مدينة الاستلام" : "التوصيل إلى"} v={city} />
            {kind === "fcl" && <Line k="عنوان المصنع" v={factory} />}
            {kind === "fcl" && <Line k="الخدمات" v={services.length ? services.map((s) => FCL_SERVICES.find((x) => x.key === s)?.name_ar).join("، ") : "الشحن فقط"} />}
          </dl>
          <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm leading-7 text-amber-900">⚠️ {customsNotice}</p>
        </div>
      )}

      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-red-700">{error}</p>}

      <div className="flex gap-3">
        {idx > 0 && <button type="button" onClick={back} className={`${btnGhost} w-1/3`}>رجوع</button>}
        {step === "review" ? (
          <button type="button" onClick={submit} disabled={busy} className={btnGold}>
            {busy ? "يرجى الانتظار..." : kind === "fcl" ? "إرسال طلب الحاوية" : "احسب السعر"}
          </button>
        ) : (
          <button type="button" onClick={next} className={btnGold}>التالي</button>
        )}
      </div>
    </div>
  );
}

// =================== UI bits ===================
const btnGold = "w-full rounded-xl bg-gradient-to-l from-[#B8923B] to-[#E0BE6E] py-4 text-lg font-bold text-[#0B1B3A] shadow-lg transition active:scale-[0.99] disabled:opacity-60";
const btnGhost = "w-full rounded-xl border-2 border-slate-200 py-3 font-bold text-slate-600";
const input = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base outline-none focus:border-[#D4AF5A] focus:ring-2 focus:ring-[#D4AF5A]/30";
const card = (on: boolean) => `rounded-xl border-2 px-4 py-3 transition ${on ? "border-[#D4AF5A] bg-[#FBF6EA]" : "border-slate-200"}`;

function Stepper({ steps, current }: { steps: StepKey[]; current: number }) {
  return (
    <ol className="flex items-center gap-1">
      {steps.map((s, i) => (
        <li key={s} className="flex flex-1 flex-col items-center gap-1">
          <span className={`grid h-8 w-8 place-items-center rounded-full text-sm font-bold ${i < current ? "bg-[#D4AF5A] text-[#0B1B3A]" : i === current ? "bg-[#0B1B3A] text-[#E9C77B]" : "bg-slate-100 text-slate-400"}`}>
            {i < current ? "✓" : i + 1}
          </span>
          <span className={`text-[11px] ${i === current ? "font-bold text-[#0B1B3A]" : "text-slate-400"}`}>{STEP_LABEL[s]}</span>
        </li>
      ))}
    </ol>
  );
}

function Totals({ t, kind }: { t: { count: number; cbm: number; kg: number; vol: number }; kind: Kind | "" }) {
  const chargeKg = Math.max(t.kg, t.vol);
  return (
    <div className="space-y-2">
      <div className={`grid ${kind === "air" ? "grid-cols-4" : "grid-cols-3"} gap-2 rounded-xl bg-slate-50 p-3 text-center text-sm`}>
        <div><p className="text-slate-500">الكراتين</p><p className="font-bold">{t.count}</p></div>
        <div><p className="text-slate-500">الحجم</p><p className="font-bold" dir="ltr">{t.cbm.toFixed(3)}</p></div>
        <div><p className="text-slate-500">الوزن الفعلي</p><p className="font-bold">{t.kg}</p></div>
        {kind === "air" && <div><p className="text-slate-500">الوزن الحجمي</p><p className="font-bold">{t.vol}</p></div>}
      </div>
      {kind === "air" && <p className="text-xs text-slate-500">الوزن المحتسب: <b>{r2(Math.max(chargeKg, 20))} كجم</b> (الأعلى بين الفعلي والحجمي{chargeKg < 20 ? "، مع تطبيق الحد الأدنى 20 كجم" : ""})</p>}
      {kind === "lcl" && t.cbm < 1 && <p className="text-xs text-amber-700">الحجم أقل من 1 CBM، وسيُحتسب على أساس 1 CBM (الحد الأدنى).</p>}
    </div>
  );
}

function SampleBanner() {
  return <p className="rounded-xl bg-blue-50 px-4 py-2 text-center text-sm text-blue-800">ℹ️ الأسعار المعروضة حالياً تجريبية</p>;
}

function Info({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm leading-7 text-slate-700">{children}</p>;
}

function Num({ label, value, onChange, decimal }: { label: string; value: string; onChange: (v: string) => void; decimal?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-slate-600">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} inputMode={decimal ? "decimal" : "numeric"} dir="ltr"
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-center text-base outline-none focus:border-[#D4AF5A] focus:ring-2 focus:ring-[#D4AF5A]/30" />
    </label>
  );
}

function Line({ k, v, hint }: { k: string; v: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <dt className="text-slate-600">{k}{hint && <span className="block text-xs text-slate-400">{hint}</span>}</dt>
      <dd className="text-left font-bold text-[#0B1B3A]">{v}</dd>
    </div>
  );
}
