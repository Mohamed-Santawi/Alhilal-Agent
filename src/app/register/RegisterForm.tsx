"use client";

import { useState } from "react";
import { REGIONS } from "@/lib/forms/regions";

type Values = Record<string, string | boolean>;
type Errors = Record<string, string>;

const initial: Values = {
  full_name: "", email: "", alt_phone: "",
  customer_type: "individual", company_name: "", cr_number: "", vat_number: "",
  region: "", city: "", district: "", street: "", building_no: "", unit_no: "",
  short_address: "", postal_code: "", additional_no: "",
  recipient_other: false, recipient_name: "", recipient_phone: "",
  privacy_consent: false,
};

const toLatinDigits = (s: string) => s.replace(/[٠-٩]/g, (c) => String("٠١٢٣٤٥٦٧٨٩".indexOf(c)));

/** Quick checks in the browser; the server re-validates everything with the real schema. */
function validate(v: Values): Errors {
  const e: Errors = {};
  const s = (k: string) => String(v[k] ?? "").trim();
  if (s("full_name").length < 3) e.full_name = "اكتب الاسم الكامل";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s("email"))) e.email = "البريد الإلكتروني غير صحيح";
  if (v.customer_type === "company") {
    if (!s("company_name")) e.company_name = "اسم المنشأة مطلوب";
    if (!/^\d{7,10}$/.test(toLatinDigits(s("cr_number")))) e.cr_number = "رقم السجل من 7 إلى 10 أرقام";
    const vat = toLatinDigits(s("vat_number")).replace(/\s/g, "");
    if (vat && !/^3\d{13}3$/.test(vat)) e.vat_number = "15 رقم يبدأ وينتهي بـ 3";
  }
  if (!s("region")) e.region = "اختار المنطقة";
  if (!s("city")) e.city = "اكتب المدينة";
  if (!s("district")) e.district = "اكتب الحي";
  if (!s("street")) e.street = "اكتب اسم الشارع";
  if (!/^\d{4}$/.test(toLatinDigits(s("building_no")))) e.building_no = "4 أرقام";
  if (!/^\d{5}$/.test(toLatinDigits(s("postal_code")))) e.postal_code = "5 أرقام";
  if (s("short_address") && !/^[A-Za-z]{4}\d{4}$/.test(s("short_address").replace(/\s/g, ""))) e.short_address = "مثال: RRRD2929";
  if (v.recipient_other) {
    if (s("recipient_name").length < 3) e.recipient_name = "اكتب اسم المستلم";
    if (toLatinDigits(s("recipient_phone")).replace(/\D/g, "").length < 9) e.recipient_phone = "رقم الجوال غير صحيح";
  }
  if (!v.privacy_consent) e.privacy_consent = "لازم توافق على سياسة الخصوصية";
  return e;
}

export default function RegisterForm({ token, privacyUrl }: { token: string; privacyUrl: string }) {
  const [v, setV] = useState<Values>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "expired" | "error">("idle");
  const [done, setDone] = useState<{ code: string; name: string } | null>(null);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const val = e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value;
    setV((p) => ({ ...p, [k]: val }));
    if (errors[k]) setErrors((p) => { const n = { ...p }; delete n[k]; return n; });
  };

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    const e = validate(v);
    setErrors(e);
    if (Object.keys(e).length) {
      document.querySelector(`[name="${Object.keys(e)[0]}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setStatus("sending");
    const s = (k: string) => toLatinDigits(String(v[k] ?? "").trim());
    const payload = {
      token,
      full_name: s("full_name"), email: s("email"), alt_phone: s("alt_phone"),
      customer_type: v.customer_type,
      company_name: v.customer_type === "company" ? s("company_name") : "",
      cr_number: v.customer_type === "company" ? s("cr_number") : "",
      vat_number: v.customer_type === "company" ? s("vat_number").replace(/\s/g, "") : "",
      region: v.region, city: s("city"), district: s("district"), street: s("street"),
      building_no: s("building_no"), unit_no: s("unit_no"),
      short_address: s("short_address").replace(/\s/g, "").toUpperCase(),
      postal_code: s("postal_code"), additional_no: s("additional_no"),
      recipient_name: v.recipient_other ? s("recipient_name") : "",
      recipient_phone: v.recipient_other ? s("recipient_phone") : "",
      privacy_consent: v.privacy_consent,
    };
    try {
      const res = await fetch("/api/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const json = await res.json().catch(() => ({}));
      if (res.ok) { setDone({ code: json.code, name: json.name }); setStatus("done"); window.scrollTo({ top: 0 }); return; }
      if (res.status === 410) { setStatus("expired"); return; }
      if (res.status === 422 && json.fieldErrors) { setErrors(json.fieldErrors); setStatus("idle"); return; }
      setStatus("error");
    } catch {
      setStatus("error");
    }
  }

  if (status === "done" && done) {
    return (
      <div className="text-center py-6">
        <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-emerald-50 text-3xl">✅</div>
        <h2 className="text-xl font-bold text-[#0B1B3A] mb-2">تم تسجيلك بنجاح يا {done.name}</h2>
        <p className="text-slate-600 mb-4">رقم العميل الخاص بيك</p>
        <p className="text-3xl font-extrabold text-[#B8923B] mb-6" dir="ltr">{done.code}</p>
        <p className="text-slate-600 leading-7">ارجع لمحادثة الواتساب، هتلاقي قايمة الخدمات مستنياك 👋</p>
      </div>
    );
  }

  if (status === "expired") {
    return (
      <div className="text-center py-6">
        <div className="text-5xl mb-4">⏳</div>
        <h2 className="text-xl font-bold text-[#0B1B3A] mb-2">الرابط انتهى</h2>
        <p className="text-slate-600 leading-7">ارجع لمحادثة الواتساب وابعت أي رسالة، وهيوصلك رابط جديد.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-7">
      <Section title="البيانات الأساسية" n={1}>
        <Field label="الاسم الكامل" name="full_name" v={v} set={set} errors={errors} autoComplete="name" />
        <Field label="البريد الإلكتروني" name="email" type="email" dir="ltr" v={v} set={set} errors={errors} autoComplete="email" />
        <Field label="جوال إضافي" name="alt_phone" type="tel" dir="ltr" optional v={v} set={set} errors={errors} autoComplete="tel" />

        <div>
          <span className="block text-sm font-medium text-slate-700 mb-2">نوع العميل</span>
          <div className="grid grid-cols-2 gap-3">
            {[["individual", "فرد"], ["company", "شركة / مؤسسة"]].map(([val, label]) => (
              <label key={val} className={`cursor-pointer rounded-xl border-2 px-4 py-3 text-center font-medium transition ${v.customer_type === val ? "border-[#D4AF5A] bg-[#FBF6EA] text-[#0B1B3A]" : "border-slate-200 text-slate-600"}`}>
                <input type="radio" name="customer_type" value={val} checked={v.customer_type === val} onChange={set("customer_type")} className="sr-only" />
                {label}
              </label>
            ))}
          </div>
        </div>

        {v.customer_type === "company" && (
          <>
            <Field label="اسم المنشأة" name="company_name" v={v} set={set} errors={errors} autoComplete="organization" />
            <Field label="رقم السجل التجاري" name="cr_number" inputMode="numeric" dir="ltr" v={v} set={set} errors={errors} />
            <Field label="رقم شهادة التسجيل في ضريبة القيمة المضافة" name="vat_number" inputMode="numeric" maxLength={15} dir="ltr" optional placeholder="3XXXXXXXXXXXXX3" v={v} set={set} errors={errors} />
          </>
        )}
      </Section>

      <Section title="العنوان الوطني" n={2} hint="عنوان التسليم داخل المملكة العربية السعودية">
        <div>
          <label htmlFor="region" className="block text-sm font-medium text-slate-700 mb-1.5">المنطقة</label>
          <select id="region" name="region" value={String(v.region)} onChange={set("region")}
            className={`w-full rounded-xl border bg-white px-4 py-3 text-base outline-none focus:border-[#D4AF5A] focus:ring-2 focus:ring-[#D4AF5A]/30 ${errors.region ? "border-red-400" : "border-slate-300"}`}>
            <option value="">اختار المنطقة</option>
            {Object.entries(REGIONS).map(([k, ar]) => <option key={k} value={k}>{ar}</option>)}
          </select>
          {errors.region && <p className="mt-1 text-sm text-red-600">{errors.region}</p>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="المدينة" name="city" v={v} set={set} errors={errors} autoComplete="address-level2" />
          <Field label="الحي" name="district" v={v} set={set} errors={errors} />
        </div>
        <Field label="الشارع" name="street" v={v} set={set} errors={errors} autoComplete="address-line1" />
        <div className="grid grid-cols-2 gap-3">
          <Field label="رقم المبنى" name="building_no" inputMode="numeric" maxLength={4} dir="ltr" v={v} set={set} errors={errors} />
          <Field label="رقم الوحدة" name="unit_no" optional dir="ltr" v={v} set={set} errors={errors} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="الرمز البريدي" name="postal_code" inputMode="numeric" maxLength={5} dir="ltr" v={v} set={set} errors={errors} autoComplete="postal-code" />
          <Field label="الرقم الإضافي" name="additional_no" inputMode="numeric" maxLength={4} optional dir="ltr" v={v} set={set} errors={errors} />
        </div>
        <Field label="العنوان المختصر" name="short_address" optional maxLength={9} dir="ltr" placeholder="RRRD2929" v={v} set={set} errors={errors} />
      </Section>

      <Section title="المستلم" n={3}>
        <label className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 cursor-pointer">
          <input type="checkbox" name="recipient_other" checked={Boolean(v.recipient_other)} onChange={set("recipient_other")} className="h-5 w-5 accent-[#B8923B]" />
          <span className="text-slate-700">مستلم الشحنات شخص آخر غيري</span>
        </label>
        {v.recipient_other && (
          <>
            <Field label="اسم المستلم" name="recipient_name" v={v} set={set} errors={errors} />
            <Field label="جوال المستلم" name="recipient_phone" type="tel" dir="ltr" v={v} set={set} errors={errors} />
          </>
        )}
      </Section>

      <div>
        <label className={`flex items-start gap-3 rounded-xl border px-4 py-3 cursor-pointer ${errors.privacy_consent ? "border-red-400 bg-red-50" : "border-slate-200"}`}>
          <input type="checkbox" name="privacy_consent" checked={Boolean(v.privacy_consent)} onChange={set("privacy_consent")} className="mt-1 h-5 w-5 accent-[#B8923B]" />
          <span className="text-slate-700 leading-7">
            أوافق على{" "}
            <a href={privacyUrl} target="_blank" rel="noopener noreferrer" className="font-bold text-[#B8923B] underline underline-offset-4">سياسة الخصوصية</a>{" "}
            وجمع بياناتي لتقديم الخدمة
          </span>
        </label>
        {errors.privacy_consent && <p className="mt-1 text-sm text-red-600">{errors.privacy_consent}</p>}
      </div>

      {status === "error" && (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-red-700">حصلت مشكلة، حاول مرة ثانية بعد شوية.</p>
      )}

      <button type="submit" disabled={status === "sending"}
        className="w-full rounded-xl bg-gradient-to-l from-[#B8923B] to-[#E0BE6E] py-4 text-lg font-bold text-[#0B1B3A] shadow-lg transition active:scale-[0.99] disabled:opacity-60">
        {status === "sending" ? "جاري التسجيل..." : "تسجيل"}
      </button>
    </form>
  );
}

function Section({ title, n, hint, children }: { title: string; n: number; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3 border-b border-slate-100 pb-2">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-[#0B1B3A] text-sm font-bold text-[#E9C77B]">{n}</span>
        <div>
          <h2 className="text-lg font-bold text-[#0B1B3A]">{title}</h2>
          {hint && <p className="text-xs text-slate-500">{hint}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function Field({
  label, name, v, set, errors, optional, type = "text", dir, ...rest
}: {
  label: string; name: string; v: Values; errors: Errors; optional?: boolean; type?: string; dir?: "ltr" | "rtl";
  set: (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "name" | "value" | "onChange" | "type" | "dir">) {
  return (
    <div>
      <label htmlFor={name} className="block text-sm font-medium text-slate-700 mb-1.5">
        {label} {optional && <span className="text-slate-400 font-normal">(اختياري)</span>}
      </label>
      <input
        id={name} name={name} type={type} dir={dir} value={String(v[name] ?? "")} onChange={set(name)}
        className={`w-full rounded-xl border px-4 py-3 text-base outline-none transition focus:border-[#D4AF5A] focus:ring-2 focus:ring-[#D4AF5A]/30 ${dir === "ltr" ? "text-left" : ""} ${errors[name] ? "border-red-400" : "border-slate-300"}`}
        {...rest}
      />
      {errors[name] && <p className="mt-1 text-sm text-red-600">{errors[name]}</p>}
    </div>
  );
}
