import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth/staff";
import { db } from "@/lib/supabase";
import { listStages, STATUS_AR, type Track } from "@/lib/orders/orders";
import { orderCancel, orderSetStage } from "../../../panel-actions";
import { ActionForm, SaveButton } from "../../../ui";
import { Badge, Card, sar, stamp } from "../../bits";

const input = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#D4AF5A] focus:ring-2 focus:ring-[#D4AF5A]/30";

export default async function OrderDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireStaff();
  const { id } = await params;
  const r = await db().from("orders").select("*, customers(code, full_name, wa_id, conversations(id)), services(name_ar)").eq("id", id).maybeSingle();
  if (!r.data) notFound();
  const o = r.data;
  const [stages, events, staff, quote] = await Promise.all([
    listStages(o.track as Track, true),
    db().from("order_events").select("*").eq("order_id", id).order("created_at", { ascending: false }),
    db().from("staff").select("id, full_name"),
    o.quote_id ? db().from("shipping_quotes").select("id, code").eq("id", o.quote_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const cu = o.customers as { code: string; full_name: string | null; wa_id: string; conversations: { id: string } | { id: string }[] | null };
  const convId = Array.isArray(cu.conversations) ? cu.conversations[0]?.id : cu.conversations?.id;
  const current = stages.findIndex((s) => s.key === o.stage);
  const active = stages.filter((s) => s.active);
  const nextStage = active.find((s) => s.sort_order > (stages[current]?.sort_order ?? 0));
  const who = (a: string) => (a === "bot" ? "🤖 البوت" : staff.data?.find((s) => s.id === a)?.full_name ?? "—");
  const name = (k: string | null) => stages.find((s) => s.key === k)?.name_ar ?? (k ?? "");
  const closed = o.status === "cancelled";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/admin/orders" className="text-xs text-slate-400 hover:text-slate-600">→ الطلبات</Link>
          <h1 className="text-xl font-extrabold text-[#0B1B3A]">
            <span dir="ltr">{o.code}</span>{" "}
            {closed ? <Badge tone="red">ملغي</Badge> : <Badge tone={o.status === "completed" ? "green" : o.status === "awaiting_payment" ? "amber" : "blue"}>{name(o.stage) || STATUS_AR[o.status]}</Badge>}
          </h1>
          <p className="text-sm text-slate-500">{o.title} · {(o.services as { name_ar: string } | null)?.name_ar}</p>
        </div>
        <div className="flex gap-2">
          {quote.data && <Link href={`/admin/quotes/${quote.data.id}`} className="rounded-lg bg-white px-4 py-2 text-sm font-bold text-[#0B1B3A] shadow-sm">🧾 {quote.data.code}</Link>}
          {convId && <Link href={`/admin/inbox/${convId}`} className="rounded-lg bg-[#0B1B3A] px-4 py-2 text-sm font-bold text-[#E9C77B]">💬 محادثة العميل</Link>}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          {/* Stage progress */}
          <Card title="مراحل الطلب">
            <ol className="space-y-0">
              {stages.filter((s) => s.active || s.key === o.stage).map((s, i, arr) => {
                const idx = stages.findIndex((x) => x.key === s.key);
                const doneStage = !closed && idx < current, now = s.key === o.stage;
                return (
                  <li key={s.key} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold ${now ? (closed ? "bg-red-500 text-white" : "bg-[#0B1B3A] text-[#E9C77B]") : doneStage ? "bg-[#D4AF5A] text-[#0B1B3A]" : "bg-slate-100 text-slate-400"}`}>
                        {doneStage ? "✓" : i + 1}
                      </span>
                      {i < arr.length - 1 && <span className={`w-0.5 flex-1 ${doneStage ? "bg-[#D4AF5A]" : "bg-slate-200"}`} style={{ minHeight: 18 }} />}
                    </div>
                    <p className={`pb-3 pt-1 text-sm ${now ? "font-extrabold text-[#0B1B3A]" : doneStage ? "text-slate-700" : "text-slate-400"}`}>
                      {s.name_ar}{now && o.stage_at && <span className="mr-2 text-xs font-normal text-slate-400">منذ {stamp(o.stage_at)}</span>}
                    </p>
                  </li>
                );
              })}
            </ol>
          </Card>

          {!closed && o.status !== "completed" && (
            <Card title="تحديث الحالة">
              <ActionForm action={orderSetStage} className="space-y-3">
                <input type="hidden" name="id" value={id} />
                <div className="flex flex-wrap items-end gap-2">
                  <label className="min-w-56 flex-1"><span className="mb-1 block text-xs text-slate-500">المرحلة الجديدة</span>
                    <select name="stage" defaultValue={nextStage?.key ?? ""} className={input}>
                      {active.map((s) => <option key={s.key} value={s.key} disabled={s.key === o.stage}>{s.name_ar}{s.key === o.stage ? " (الحالية)" : ""}</option>)}
                    </select>
                  </label>
                  <label className="min-w-56 flex-[2]"><span className="mb-1 block text-xs text-slate-500">ملاحظة للعميل (اختياري)</span>
                    <input name="note" maxLength={300} placeholder="مثال: رقم البوليصة 12345" className={input} /></label>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="notify" defaultChecked className="h-4 w-4 accent-[#B8923B]" /> إرسال إشعار للعميل على واتساب</label>
                  <SaveButton label="تحديث" />
                </div>
              </ActionForm>
            </Card>
          )}

          <Card title="سجل الطلب">
            <ul className="space-y-2 text-sm">
              {events.data?.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
                  <span>
                    {e.to_status === "cancelled" ? "إلغاء الطلب" : e.from_stage ? `${name(e.from_stage)} ← ${name(e.to_stage)}` : `إنشاء الطلب (${name(e.to_stage)})`}
                    {e.note && <span className="block text-xs text-slate-500">{e.note}</span>}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-slate-500">
                    {e.notified === true && <Badge tone="green">وصل إشعار</Badge>}
                    {e.notified === false && <Badge tone="red">لم يصل إشعار</Badge>}
                    {who(e.actor)} · {stamp(e.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <aside className="space-y-4">
          <Card title="العميل">
            <p className="font-bold text-[#0B1B3A]">{cu.full_name ?? "—"}</p>
            <p className="text-sm text-slate-500">{cu.code} · <span dir="ltr">+{cu.wa_id}</span></p>
          </Card>
          <Card title="المبلغ">
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">قبل الضريبة</dt><dd>{o.base_amount !== null ? `${sar(o.base_amount)} ريال` : "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">الضريبة {Number(o.vat_rate)}%</dt><dd>{o.vat_amount !== null ? `${sar(o.vat_amount)} ريال` : "—"}</dd></div>
              <div className="flex justify-between font-extrabold text-[#0B1B3A]"><dt>الإجمالي</dt><dd>{o.total_amount !== null ? `${sar(o.total_amount)} ريال` : "—"}</dd></div>
            </dl>
          </Card>
          {!closed && o.status !== "completed" && (
            <Card title="إلغاء الطلب">
              <ActionForm action={orderCancel} confirm={`إلغاء الطلب ${o.code}؟`} className="space-y-2">
                <input type="hidden" name="id" value={id} />
                <input name="reason" placeholder="السبب (اختياري)" className={input} />
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="notify" defaultChecked className="h-4 w-4 accent-[#B8923B]" /> إبلاغ العميل</label>
                <SaveButton label="إلغاء الطلب" variant="danger" />
              </ActionForm>
            </Card>
          )}
          {closed && o.cancelled_reason && <Card title="سبب الإلغاء"><p className="text-sm">{o.cancelled_reason}</p></Card>}
        </aside>
      </div>
    </div>
  );
}
