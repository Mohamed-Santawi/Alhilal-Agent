import Link from "next/link";
import { requireStaff } from "@/lib/auth/staff";
import { listStages } from "@/lib/orders/orders";
import { saveStage } from "../../../panel-actions";
import { ActionForm, SaveButton } from "../../../ui";
import { Card, PageTitle } from "../../bits";

const input = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#D4AF5A] focus:ring-2 focus:ring-[#D4AF5A]/30";

export default async function Stages() {
  await requireStaff(["admin"]);
  const stages = await listStages(undefined, true);
  return (
    <div className="space-y-4">
      <Link href="/admin/orders" className="text-xs text-slate-400 hover:text-slate-600">→ الطلبات</Link>
      <PageTitle title="مراحل الطلب" hint="الاسم والرسالة يظهران للعميل. المرحلة الموقوفة لا تظهر عند تحديث الطلبات." />
      {(["shipping", "service"] as const).map((track) => (
        <Card key={track} title={track === "shipping" ? "طلبات الشحن" : "طلبات الخدمات"}>
          <div className="space-y-3">
            {stages.filter((s) => s.track === track).map((s, i) => (
              <ActionForm key={s.key} action={saveStage} className={`grid gap-2 rounded-xl border border-slate-200 p-3 md:grid-cols-[2rem_1fr_2fr_auto] md:items-end ${s.active ? "" : "opacity-60"}`}>
                <input type="hidden" name="key" value={s.key} />
                <span className="grid h-8 w-8 place-items-center rounded-full bg-slate-100 text-sm font-bold">{i + 1}</span>
                <label><span className="mb-1 block text-xs text-slate-500">اسم المرحلة</span><input name="name_ar" defaultValue={s.name_ar} className={input} /></label>
                <label><span className="mb-1 block text-xs text-slate-500">رسالة العميل</span><input name="message_ar" defaultValue={s.message_ar ?? ""} className={input} /></label>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="notify" defaultChecked={s.notify} className="accent-[#B8923B]" /> إشعار</label>
                  <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="active" defaultChecked={s.active} className="accent-[#B8923B]" /> مفعّلة</label>
                  <SaveButton />
                </div>
              </ActionForm>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
