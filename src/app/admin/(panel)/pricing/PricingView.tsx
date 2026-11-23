/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  addSurcharge, deleteSurcharge, disableShippingRate, saveCategory, toggleSurcharge,
  updateFclPrice, updateService, updateSettings, updateShippingRate,
} from "../../actions";
import { ActionForm, SaveButton } from "../../ui";

const n = (v: unknown) => Number(v ?? 0);
const sar = (x: number) => x.toLocaleString("en-US", { maximumFractionDigits: 2 });
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { timeZone: "Asia/Riyadh" }) : "—");

const MODE: Record<string, { label: string; unit: string; minUnit: string }> = {
  air: { label: "جوي ✈️", unit: "ريال / كجم", minUnit: "كجم" },
  sea: { label: "بحري مجمّع LCL 🚢", unit: "ريال / CBM", minUnit: "CBM" },
};
const ACTION_AR: Record<string, string> = {
  "rate.changed": "تغيير سعر شحن", "rate.disabled": "إيقاف طريقة شحن", "fcl.price_changed": "تغيير سعر حاوية",
  "fcl.price_removed": "حاوية «السعر عند الطلب»", "category.created": "إضافة نوع بضاعة", "category.updated": "تعديل نوع بضاعة",
  "surcharge.created": "إضافة رسوم", "surcharge.enabled": "تشغيل رسوم", "surcharge.disabled": "إيقاف رسوم",
  "surcharge.deleted": "حذف رسوم", "service.updated": "تعديل خدمة", "settings.updated": "تعديل الإعدادات",
};

const input = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#D4AF5A] focus:ring-2 focus:ring-[#D4AF5A]/30";

export type PricingData = {
  cats: any[]; rates: any[]; containers: any[]; fcl: any[]; surcharges: any[]; services: any[];
  settings: any; staff: { id: string; full_name: string }[]; log: any[]; t: string;
};

export default function PricingView({ data }: { data: PricingData }) {
  const { t } = data;
  const cats = { data: data.cats }, containers = { data: data.containers }, surcharges = { data: data.surcharges };
  const services = { data: data.services }, log = { data: data.log };
  const rateOf = (cat: string, mode: string) => data.rates.find((r) => r.category_key === cat && r.mode === mode);
  const fclOf = (key: string) => data.fcl.find((r) => r.container_key === key);
  const who = (id: string) => data.staff.find((s) => s.id === id)?.full_name ?? id;
  const s = data.settings;

  return (
    <div className="space-y-6">
      {s.prices_are_samples && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          ⚠️ الحاسبة بتعرض للعملاء «الأسعار المعروضة حالياً تجريبية». بعد ما تحط أسعارك الحقيقية، اقفل الخيار ده من <b>الإعدادات</b> تحت.
        </div>
      )}

      {/* ---------------- Air / LCL per category ---------------- */}
      <Card title="أسعار الشحن الجوي والبحري المجمّع" hint="السعر الجديد يتطبّق على الحاسبة فوراً. التسعيرات اللي اتبعتت قبل كده للعملاء ما بتتغيرش.">
        <div className="space-y-4">
          {cats.data?.map((c) => (
            <div key={c.key} className={`rounded-xl border border-slate-200 p-4 ${c.active ? "" : "opacity-60"}`}>
              <ActionForm action={saveCategory} className="mb-3 flex flex-wrap items-end gap-2">
                <input type="hidden" name="key" value={c.key} />
                <label className="min-w-40 flex-1"><span className="mb-1 block text-xs text-slate-500">نوع البضاعة</span><input name="name_ar" defaultValue={c.name_ar} className={`${input} font-bold`} /></label>
                <label className="min-w-48 flex-[2]"><span className="mb-1 block text-xs text-slate-500">وصف قصير (بيظهر للعميل)</span><input name="hint_ar" defaultValue={c.hint_ar ?? ""} className={input} /></label>
                <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="active" defaultChecked={c.active} className="h-4 w-4 accent-[#B8923B]" /> ظاهر للعملاء</label>
                <SaveButton variant="ghost" />
              </ActionForm>

              <div className="grid gap-3 md:grid-cols-2">
                {(["air", "sea"] as const).map((m) => {
                  const r = rateOf(c.key, m);
                  return (
                    <div key={m} className="rounded-lg bg-slate-50 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="font-bold text-[#0B1B3A]">{MODE[m].label}</span>
                        {r ? <span className="text-xs text-slate-500">من {day(r.effective_from)}</span> : <span className="text-xs text-red-600">غير متاح</span>}
                      </div>
                      <ActionForm action={updateShippingRate} className="flex flex-wrap items-end gap-2">
                        <input type="hidden" name="category_key" value={c.key} />
                        <input type="hidden" name="mode" value={m} />
                        <label className="w-28"><span className="mb-1 block text-xs text-slate-500">السعر ({MODE[m].unit})</span><input name="unit_price" inputMode="decimal" dir="ltr" defaultValue={r ? n(r.unit_price) : ""} className={input} /></label>
                        <label className="w-24"><span className="mb-1 block text-xs text-slate-500">أقل كمية ({MODE[m].minUnit})</span><input name="min_qty" inputMode="decimal" dir="ltr" defaultValue={r ? n(r.min_qty) : m === "air" ? 20 : 1} className={input} /></label>
                        <label className="w-24"><span className="mb-1 block text-xs text-slate-500">أقل مبلغ (ريال)</span><input name="min_charge" inputMode="decimal" dir="ltr" defaultValue={r ? n(r.min_charge) : 0} className={input} /></label>
                        <SaveButton />
                      </ActionForm>
                      {r && (
                        <ActionForm action={disableShippingRate} className="mt-2" confirm={`إيقاف ${MODE[m].label} لـ «${c.name_ar}»؟`}>
                          <input type="hidden" name="category_key" value={c.key} />
                          <input type="hidden" name="mode" value={m} />
                          <button className="text-xs text-red-600 hover:underline">إيقاف الطريقة دي للنوع ده</button>
                        </ActionForm>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <ActionForm action={saveCategory} className="flex flex-wrap items-end gap-2 rounded-xl border-2 border-dashed border-[#D4AF5A] p-4">
            <label className="min-w-40 flex-1"><span className="mb-1 block text-xs text-slate-500">نوع بضاعة جديد</span><input name="name_ar" placeholder="مثال: أثاث" className={input} /></label>
            <label className="min-w-48 flex-[2]"><span className="mb-1 block text-xs text-slate-500">وصف قصير</span><input name="hint_ar" placeholder="مثال: كنب، طاولات، كراسي" className={input} /></label>
            <SaveButton label="+ إضافة" />
          </ActionForm>
        </div>
      </Card>

      {/* ---------------- FCL ---------------- */}
      <Card title="الحاويات الكاملة FCL" hint="سعر الحاوية الواحدة قبل الضريبة. لو سبت السعر فاضي، الحاوية هتظهر «السعر عند الطلب».">
        <div className="grid gap-3 md:grid-cols-3">
          {containers.data?.map((c) => {
            const r = fclOf(c.key);
            return (
              <ActionForm key={c.key} action={updateFclPrice} className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-3">
                <input type="hidden" name="container_key" value={c.key} />
                <p className="basis-full font-bold text-[#0B1B3A]">{c.name_ar}</p>
                <label className="flex-1"><span className="mb-1 block text-xs text-slate-500">ريال / حاوية</span><input name="price" inputMode="decimal" dir="ltr" defaultValue={r ? n(r.price) : ""} placeholder="عند الطلب" className={input} /></label>
                <SaveButton />
              </ActionForm>
            );
          })}
        </div>
      </Card>

      {/* ---------------- Surcharges ---------------- */}
      <Card title="رسوم الظروف (حرب، موسم ذروة...)" hint="بتتضاف على سعر الشحن تلقائياً طول ما هي شغالة وفي مدتها.">
        <div className="space-y-2">
          {surcharges.data?.length === 0 && <p className="text-sm text-slate-500">مفيش رسوم إضافية حالياً.</p>}
          {surcharges.data?.map((x) => {
            const live = x.active && x.starts_at <= t && (!x.ends_at || x.ends_at > t);
            return (
              <div key={x.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2">
                <div>
                  <p className="font-bold">{x.name_ar} <span className="text-sm font-normal text-slate-500">· {x.mode === "air" ? "جوي" : x.mode === "sea" ? "بحري (LCL و FCL)" : "الكل"} · {x.kind === "percent" ? `${n(x.amount)}%` : `${sar(n(x.amount))} ريال`}</span></p>
                  <p className="text-xs text-slate-500">من {day(x.starts_at)} لحد {day(x.ends_at)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${live ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{live ? "شغالة الآن" : x.active ? "مش في مدتها" : "مطفية"}</span>
                  <ActionForm action={toggleSurcharge}>
                    <input type="hidden" name="id" value={x.id} />
                    <input type="hidden" name="active" value={String(!x.active)} />
                    <SaveButton label={x.active ? "إيقاف" : "تشغيل"} variant="ghost" />
                  </ActionForm>
                  <ActionForm action={deleteSurcharge} confirm={`حذف «${x.name_ar}»؟`}>
                    <input type="hidden" name="id" value={x.id} />
                    <SaveButton label="حذف" variant="danger" />
                  </ActionForm>
                </div>
              </div>
            );
          })}
        </div>
        <ActionForm action={addSurcharge} className="mt-4 flex flex-wrap items-end gap-2 rounded-xl border-2 border-dashed border-[#D4AF5A] p-4">
          <label className="min-w-40 flex-1"><span className="mb-1 block text-xs text-slate-500">اسم الرسوم</span><input name="name_ar" placeholder="رسوم مخاطر حرب" className={input} /></label>
          <label className="w-36"><span className="mb-1 block text-xs text-slate-500">على</span>
            <select name="mode" className={input}><option value="">كل الشحن</option><option value="sea">بحري (LCL و FCL)</option><option value="air">جوي</option></select></label>
          <label className="w-28"><span className="mb-1 block text-xs text-slate-500">النوع</span>
            <select name="kind" className={input}><option value="percent">نسبة %</option><option value="fixed">مبلغ ثابت</option></select></label>
          <label className="w-24"><span className="mb-1 block text-xs text-slate-500">القيمة</span><input name="amount" inputMode="decimal" dir="ltr" className={input} /></label>
          <label className="w-36"><span className="mb-1 block text-xs text-slate-500">من (اختياري)</span><input type="date" name="starts_at" className={input} /></label>
          <label className="w-36"><span className="mb-1 block text-xs text-slate-500">لحد (اختياري)</span><input type="date" name="ends_at" className={input} /></label>
          <SaveButton label="+ إضافة" />
        </ActionForm>
      </Card>

      {/* ---------------- Other services ---------------- */}
      <Card title="أسعار الخدمات الأخرى" hint="الأسعار الثابتة قبل الضريبة. الخدمات اللي «حسب الطلب» بيسعّرها الموظف لكل عميل.">
        <div className="grid gap-2 md:grid-cols-2">
          {services.data?.map((sv) => (
            <ActionForm key={sv.key} action={updateService} className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-3">
              <input type="hidden" name="key" value={sv.key} />
              <p className="basis-full font-bold text-[#0B1B3A]">{sv.name_ar}</p>
              {sv.pricing === "fixed" && <label className="w-32"><span className="mb-1 block text-xs text-slate-500">ريال</span><input name="base_price" inputMode="decimal" dir="ltr" defaultValue={n(sv.base_price)} className={input} /></label>}
              {sv.pricing === "percentage" && <label className="w-32"><span className="mb-1 block text-xs text-slate-500">نسبة %</span><input name="percentage" inputMode="decimal" dir="ltr" defaultValue={n(sv.percentage)} className={input} /></label>}
              {sv.pricing === "custom" && <p className="pb-2 text-sm text-slate-500">حسب الطلب</p>}
              <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="active" defaultChecked={sv.active} className="h-4 w-4 accent-[#B8923B]" /> ظاهرة</label>
              <SaveButton />
            </ActionForm>
          ))}
        </div>
      </Card>

      {/* ---------------- Settings ---------------- */}
      <Card title="الإعدادات">
        <ActionForm action={updateSettings} className="flex flex-wrap items-end gap-3">
          <label className="w-36"><span className="mb-1 block text-xs text-slate-500">ضريبة القيمة المضافة %</span><input name="vat_rate" inputMode="decimal" dir="ltr" defaultValue={n(s.vat_rate)} className={input} /></label>
          <label className="w-36"><span className="mb-1 block text-xs text-slate-500">صلاحية التسعيرة (أيام)</span><input name="quote_validity_days" inputMode="numeric" dir="ltr" defaultValue={n(s.quote_validity_days)} className={input} /></label>
          <label className="w-40"><span className="mb-1 block text-xs text-slate-500">معامل الوزن الحجمي (جوي)</span><input name="air_volumetric_divisor" inputMode="numeric" dir="ltr" defaultValue={n(s.air_volumetric_divisor)} className={input} /></label>
          <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="prices_are_samples" defaultChecked={s.prices_are_samples} className="h-4 w-4 accent-[#B8923B]" /> إظهار «أسعار تجريبية» للعملاء</label>
          <SaveButton />
        </ActionForm>
      </Card>

      {/* ---------------- Audit ---------------- */}
      <Card title="سجل التغييرات" hint="آخر 25 تعديل على الأسعار">
        {log.data?.length === 0 && <p className="text-sm text-slate-500">لسه مفيش تعديلات.</p>}
        <ul className="divide-y divide-slate-100 text-sm">
          {log.data?.map((l) => (
            <li key={l.id} className="flex flex-wrap justify-between gap-2 py-2">
              <span><b>{ACTION_AR[l.action] ?? l.action}</b> <span className="text-slate-500">{summary(l.data)}</span></span>
              <span className="text-xs text-slate-500">{who(l.actor)} · {new Date(l.created_at).toLocaleString("en-GB", { timeZone: "Asia/Riyadh", dateStyle: "short", timeStyle: "short" })}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function summary(d: Record<string, unknown> | null): string {
  if (!d) return "";
  const b = d.before as Record<string, unknown> | number | null | undefined;
  const a = d.after as Record<string, unknown> | number | undefined;
  const label = [d.category, d.mode, d.container, d.name_ar].filter(Boolean).join(" · ");
  const fmt = (x: unknown) => (x && typeof x === "object" ? Object.values(x as object).join(" / ") : String(x ?? "—"));
  return `${label}${a !== undefined ? ` — ${fmt(b)} ← ${fmt(a)}` : ""}`;
}

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm">
      <h2 className="text-lg font-extrabold text-[#0B1B3A]">{title}</h2>
      {hint && <p className="mb-4 mt-1 text-sm text-slate-500">{hint}</p>}
      {!hint && <div className="mb-4" />}
      {children}
    </section>
  );
}
