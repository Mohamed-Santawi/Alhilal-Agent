import { requireStaff, ROLE_AR, type StaffRole } from "@/lib/auth/staff";
import { db } from "@/lib/supabase";
import { addStaff, updateStaff } from "../../panel-actions";
import { ActionForm, SaveButton } from "../../ui";
import { Badge, Card, PageTitle } from "../bits";

const input = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#D4AF5A] focus:ring-2 focus:ring-[#D4AF5A]/30";
const ROLE_HINT: Record<StaffRole, string> = {
  admin: "كل شيء، ومنها الأسعار والموظفون", finance: "المحادثات والمهام + الأسعار", sales: "المحادثات والمهام والتسعيرات",
  china_team: "المحادثات والمهام والتسعيرات", legal: "المحادثات والمهام والتسعيرات", support: "المحادثات والمهام والتسعيرات",
};

export default async function StaffAdmin() {
  const me = await requireStaff(["admin"]);
  const { data } = await db().from("staff").select("id, full_name, email, role, wa_id, notify, active, created_at").order("created_at");
  const roles = Object.keys(ROLE_AR) as StaffRole[];

  return (
    <div className="space-y-4">
      <PageTitle title="الموظفون" hint="كل موظف يدخل اللوحة ببريده وكلمة مروره. التنبيه على واتساب يصل للموظف عند كل طلب جديد." />

      <div className="space-y-2">
        {data?.map((s) => (
          <div key={s.id} className={`rounded-2xl bg-white p-4 shadow-sm ${s.active ? "" : "opacity-60"}`}>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="font-extrabold text-[#0B1B3A]">{s.full_name}</span>
              <span className="text-sm text-slate-500" dir="ltr">{s.email}</span>
              {s.id === me.id && <Badge tone="navy">أنت</Badge>}
              {!s.active && <Badge tone="red">موقوف</Badge>}
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <ActionForm action={updateStaff} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="id" value={s.id} /><input type="hidden" name="op" value="save" />
                <label className="w-40"><span className="mb-1 block text-xs text-slate-500">الدور</span>
                  <select name="role" defaultValue={s.role} className={input}>{roles.map((r) => <option key={r} value={r}>{ROLE_AR[r]}</option>)}</select></label>
                <label className="w-40"><span className="mb-1 block text-xs text-slate-500">واتساب للتنبيهات</span>
                  <input name="wa_id" defaultValue={s.wa_id ?? ""} placeholder="05xxxxxxxx" dir="ltr" className={input} /></label>
                <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="notify" defaultChecked={s.notify} className="h-4 w-4 accent-[#B8923B]" /> تنبيه بكل طلب</label>
                <SaveButton />
              </ActionForm>
              <ActionForm action={updateStaff} className="flex items-end gap-2">
                <input type="hidden" name="id" value={s.id} /><input type="hidden" name="op" value="password" />
                <label className="w-40"><span className="mb-1 block text-xs text-slate-500">كلمة مرور جديدة</span>
                  <input name="password" type="password" autoComplete="new-password" className={input} /></label>
                <SaveButton label="تغيير" variant="ghost" />
              </ActionForm>
              {s.id !== me.id && (
                <ActionForm action={updateStaff} confirm={s.active ? `إيقاف حساب ${s.full_name}؟` : undefined}>
                  <input type="hidden" name="id" value={s.id} /><input type="hidden" name="op" value="toggle" />
                  <SaveButton label={s.active ? "إيقاف" : "تفعيل"} variant={s.active ? "danger" : "ghost"} />
                </ActionForm>
              )}
            </div>
          </div>
        ))}
      </div>

      <Card title="إضافة موظف">
        <ActionForm action={addStaff} className="flex flex-wrap items-end gap-3">
          <label className="w-48"><span className="mb-1 block text-xs text-slate-500">الاسم</span><input name="full_name" className={input} /></label>
          <label className="w-56"><span className="mb-1 block text-xs text-slate-500">البريد الإلكتروني</span><input name="email" type="email" dir="ltr" autoComplete="off" className={input} /></label>
          <label className="w-44"><span className="mb-1 block text-xs text-slate-500">كلمة المرور (8 أحرف أو أكثر)</span><input name="password" type="password" autoComplete="new-password" className={input} /></label>
          <label className="w-40"><span className="mb-1 block text-xs text-slate-500">الدور</span>
            <select name="role" defaultValue="support" className={input}>{roles.map((r) => <option key={r} value={r}>{ROLE_AR[r]}</option>)}</select></label>
          <label className="w-40"><span className="mb-1 block text-xs text-slate-500">واتساب (اختياري)</span><input name="wa_id" placeholder="05xxxxxxxx" dir="ltr" className={input} /></label>
          <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="notify" className="h-4 w-4 accent-[#B8923B]" /> تنبيه بكل طلب</label>
          <SaveButton label="+ إضافة" />
        </ActionForm>
        <ul className="mt-4 space-y-1 text-xs text-slate-500">
          {roles.map((r) => <li key={r}><b>{ROLE_AR[r]}:</b> {ROLE_HINT[r]}</li>)}
          <li className="pt-2">⚠️ تنبيه واتساب يصل فقط إذا راسل الموظف رقم الشركة خلال آخر 24 ساعة (قاعدة واتساب). في الرقم التجريبي يجب أيضاً إضافة رقمه لقائمة الأرقام المسموح بها.</li>
        </ul>
      </Card>
    </div>
  );
}
