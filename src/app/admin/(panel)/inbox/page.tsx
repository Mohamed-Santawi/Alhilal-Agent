import Link from "next/link";
import { requireStaff } from "@/lib/auth/staff";
import { db } from "@/lib/supabase";
import { AutoRefresh } from "../../live";
import { Badge, Empty, PageTitle, safeQ, SearchBox, Tabs, when } from "../bits";

type Row = {
  id: string; mode: string; code: string; full_name: string | null; wa_id: string; company_name: string | null;
  registration_complete: boolean; last_body: string | null; last_direction: string | null; last_type: string | null;
  last_at: string | null; unread: number; open_tasks: number; state: Record<string, unknown>;
};

export default async function Inbox({ searchParams }: { searchParams: Promise<{ f?: string; q?: string }> }) {
  await requireStaff();
  const { f = "attention", q } = await searchParams;
  const term = safeQ(q);

  let query = db().from("staff_inbox").select("*").order("last_at", { ascending: false, nullsFirst: false }).limit(100);
  if (f === "attention") query = query.or("mode.eq.human,open_tasks.gt.0");
  if (f === "human") query = query.eq("mode", "human");
  if (term) query = query.or(`full_name.ilike.*${term}*,wa_id.ilike.*${term}*,code.ilike.*${term}*,company_name.ilike.*${term}*`);
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as Row[];

  return (
    <>
      <AutoRefresh ms={15000} />
      <PageTitle title="المحادثات" hint="تتحدّث تلقائياً. «تحتاج متابعة» = عميل طلب موظفاً أو لديه طلب مفتوح.">
        <SearchBox base="/admin/inbox" q={q} placeholder="الاسم، الجوال، رقم العميل" hidden={{ f }} />
      </PageTitle>
      <div className="mb-4">
        <Tabs base="/admin/inbox" param="f" value={f} keep={{ q }} items={[["attention", "تحتاج متابعة"], ["human", "مع موظف"], ["all", "كل المحادثات"]]} />
      </div>

      {rows.length === 0 ? (
        <Empty>{f === "attention" ? "لا توجد محادثات تحتاج متابعة الآن ✓" : "لا توجد محادثات."}</Empty>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white shadow-sm">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/admin/inbox/${r.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#0B1B3A] text-sm font-bold text-[#E9C77B]">
                  {(r.full_name ?? "؟").trim().charAt(0)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-[#0B1B3A]">{r.full_name ?? "عميل غير مسجّل"}</span>
                    <span className="text-xs text-slate-400" dir="ltr">+{r.wa_id}</span>
                    <span className="text-xs text-slate-400">{r.code}</span>
                    {r.mode === "human" ? <Badge tone="navy">👤 مع موظف</Badge> : <Badge>🤖 البوت</Badge>}
                    {r.open_tasks > 0 && <Badge tone="gold">{r.open_tasks} طلب مفتوح</Badge>}
                  </div>
                  <p className="mt-0.5 truncate text-sm text-slate-500">
                    {r.last_direction === "out" ? "↩︎ " : ""}{preview(r)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-xs text-slate-400">{when(r.last_at)}</span>
                  {r.unread > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-emerald-500 px-1.5 text-xs font-bold text-white">{r.unread}</span>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function preview(r: Row) {
  if (r.last_type === "image") return "📷 صورة";
  if (r.last_type === "audio") return "🎤 رسالة صوتية";
  if (r.last_type === "document") return "📄 ملف";
  if (r.last_type === "video") return "🎬 فيديو";
  return (r.last_body ?? "").replace(/\s+/g, " ").slice(0, 120) || "—";
}
