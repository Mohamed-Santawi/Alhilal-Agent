import Link from "next/link";
import { requireStaff } from "@/lib/auth/staff";
import { db } from "@/lib/supabase";
import { TASK_TYPE_AR } from "@/lib/bot/tasks";
import { updateTask } from "../../panel-actions";
import { ActionForm, SaveButton } from "../../ui";
import { AutoRefresh } from "../../live";
import { Badge, Empty, PageTitle, stamp, Tabs, when } from "../bits";

type Task = {
  id: string; type: string; title: string; status: string; note: string | null; due_at: string | null; created_at: string; done_at: string | null;
  assigned_to: string | null; done_by: string | null; quote_id: string | null;
  customers: { code: string; full_name: string | null; wa_id: string; conversations: { id: string } | { id: string }[] | null } | null;
};

export default async function Tasks({ searchParams }: { searchParams: Promise<{ s?: string; t?: string; mine?: string }> }) {
  const me = await requireStaff();
  const { s = "open", t = "all", mine } = await searchParams;

  let q = db().from("tasks")
    .select("id, type, title, status, note, due_at, created_at, done_at, assigned_to, done_by, quote_id, customers(code, full_name, wa_id, conversations(id))")
    .limit(200);
  q = s === "done" ? q.eq("status", "done").order("done_at", { ascending: false }) : q.in("status", ["open", "in_progress", "escalated"]).order("due_at", { ascending: true });
  if (t !== "all") q = q.eq("type", t);
  if (mine) q = q.eq("assigned_to", me.id);
  const [{ data, error }, staff] = await Promise.all([q, db().from("staff").select("id, full_name")]);
  if (error) throw error;
  const tasks = (data ?? []) as unknown as Task[];
  const name = (id: string | null) => staff.data?.find((x) => x.id === id)?.full_name ?? "—";
  const convId = (x: Task) => { const c = x.customers?.conversations; return Array.isArray(c) ? c[0]?.id : c?.id; };

  return (
    <>
      <AutoRefresh ms={20000} />
      <PageTitle title="المهام" hint="كل طلب من عميل يصبح مهمة هنا: طلب موظف، طلب شحن، طلب حاوية، طلب خدمة." />
      <div className="mb-4 flex flex-wrap gap-2">
        <Tabs base="/admin/tasks" param="s" value={s} keep={{ t, mine }} items={[["open", "المفتوحة"], ["done", "المغلقة"]]} />
        <Tabs base="/admin/tasks" param="t" value={t} keep={{ s, mine }}
          items={[["all", "الكل"], ["handoff", "طلب موظف"], ["shipping_quote", "شحن"], ["fcl_request", "حاويات"], ["service_request", "خدمات"]]} />
        <Tabs base="/admin/tasks" param="mine" value={mine ?? ""} keep={{ s, t }} items={[["", "كل الموظفين"], ["1", "مهامي"]]} />
      </div>

      {tasks.length === 0 ? <Empty>{s === "open" ? "لا توجد مهام مفتوحة ✓" : "لا توجد مهام."}</Empty> : (
        <ul className="space-y-2">
          {tasks.map((x) => {
            const overdue = x.status !== "done" && x.due_at && new Date(x.due_at) < new Date();
            const cid = convId(x);
            return (
              <li key={x.id} className={`rounded-2xl bg-white p-4 shadow-sm ${overdue ? "border-r-4 border-red-400" : ""}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="gold">{TASK_TYPE_AR[x.type] ?? x.type}</Badge>
                      {x.status === "in_progress" && <Badge tone="blue">قيد العمل — {name(x.assigned_to)}</Badge>}
                      {x.status === "done" && <Badge tone="green">تمت — {name(x.done_by)}</Badge>}
                      {overdue && <Badge tone="red">متأخرة</Badge>}
                      <span className="text-xs text-slate-400">{when(x.created_at)}</span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-700">{x.title}</p>
                    {x.note && <p className="mt-1 rounded-lg bg-slate-50 px-2 py-1 text-xs text-slate-600">📝 {x.note}</p>}
                    <div className="mt-2 flex flex-wrap gap-3 text-xs">
                      {cid && <Link href={`/admin/inbox/${cid}`} className="font-bold text-[#B8923B]">💬 محادثة {x.customers?.full_name ?? x.customers?.code}</Link>}
                      {x.quote_id && <Link href={`/admin/quotes/${x.quote_id}`} className="font-bold text-[#B8923B]">🧾 تفاصيل الطلب</Link>}
                      {x.status !== "done" && x.due_at && <span className="text-slate-400">الموعد: {stamp(x.due_at)}</span>}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {x.status === "open" && (
                      <ActionForm action={updateTask}>
                        <input type="hidden" name="id" value={x.id} /><input type="hidden" name="op" value="take" />
                        <SaveButton label="أنا لها" variant="ghost" />
                      </ActionForm>
                    )}
                    {x.status !== "done" ? (
                      <ActionForm action={updateTask} className="flex items-center gap-2">
                        <input type="hidden" name="id" value={x.id} /><input type="hidden" name="op" value="done" />
                        <input name="note" placeholder="ملاحظة (اختياري)" className="w-40 rounded-lg border border-slate-300 px-2 py-2 text-sm" />
                        <SaveButton label="تمت ✓" />
                      </ActionForm>
                    ) : (
                      <ActionForm action={updateTask}>
                        <input type="hidden" name="id" value={x.id} /><input type="hidden" name="op" value="reopen" />
                        <SaveButton label="إعادة فتح" variant="ghost" />
                      </ActionForm>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
