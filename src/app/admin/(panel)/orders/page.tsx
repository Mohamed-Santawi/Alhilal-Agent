import Link from "next/link";
import { requireStaff } from "@/lib/auth/staff";
import { db } from "@/lib/supabase";
import { listStages, STATUS_AR } from "@/lib/orders/orders";
import { AutoRefresh } from "../../live";
import { Badge, Empty, PageTitle, safeQ, sar, SearchBox, Tabs, when } from "../bits";

export default async function Orders({ searchParams }: { searchParams: Promise<{ s?: string; t?: string; st?: string; q?: string }> }) {
  const me = await requireStaff();
  const { s = "open", t = "all", st, q } = await searchParams;
  const term = safeQ(q);
  const stages = await listStages(undefined, true);

  let query = db().from("orders")
    .select("id, code, title, status, track, stage, stage_at, total_amount, created_at, customers(code, full_name, wa_id)")
    .order("created_at", { ascending: false }).limit(200);
  if (s === "open") query = query.not("status", "in", "(completed,cancelled)");
  if (s === "done") query = query.eq("status", "completed");
  if (s === "cancelled") query = query.eq("status", "cancelled");
  if (t !== "all") query = query.eq("track", t);
  if (st) query = query.eq("stage", st);
  if (term) query = query.ilike("code", `*${term}*`);
  const { data, error } = await query;
  if (error) throw error;
  const stageName = (k: string | null) => stages.find((x) => x.key === k)?.name_ar ?? "—";

  return (
    <>
      <AutoRefresh ms={30000} />
      <PageTitle title="الطلبات" hint="كل طلب له رقم ومراحل. عند تغيير المرحلة يصل للعميل إشعار على واتساب.">
        <div className="flex items-center gap-2">
          <SearchBox base="/admin/orders" q={q} placeholder="رقم الطلب HA-ORD-…" hidden={{ s, t }} />
          {me.role === "admin" && <Link href="/admin/orders/stages" className="rounded-lg bg-white px-3 py-2 text-sm font-bold text-[#0B1B3A] shadow-sm">⚙️ المراحل</Link>}
        </div>
      </PageTitle>
      <div className="mb-4 flex flex-wrap gap-2">
        <Tabs base="/admin/orders" param="s" value={s} keep={{ t, q }} items={[["open", "الجارية"], ["done", "المكتملة"], ["cancelled", "الملغاة"], ["all", "الكل"]]} />
        <Tabs base="/admin/orders" param="t" value={t} keep={{ s, q }} items={[["all", "كل الأنواع"], ["shipping", "شحن"], ["service", "خدمات"]]} />
      </div>
      {t !== "all" && (
        <div className="mb-4 flex flex-wrap gap-1">
          {stages.filter((x) => x.track === t).map((x) => (
            <Link key={x.key} href={`/admin/orders?${new URLSearchParams({ s, t, ...(st === x.key ? {} : { st: x.key }) })}`}
              className={`rounded-full px-3 py-1 text-xs ${st === x.key ? "bg-[#D4AF5A] font-bold text-[#0B1B3A]" : "bg-white text-slate-600 shadow-sm"}`}>{x.name_ar}</Link>
          ))}
        </div>
      )}

      {!data?.length ? <Empty>لا توجد طلبات.</Empty> : (
        <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>{["رقم الطلب", "العميل", "الطلب", "المرحلة", "منذ", "الإجمالي", "تاريخ الطلب"].map((h) => <th key={h} className="px-3 py-2 text-right font-medium">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.map((o) => {
                const cu = o.customers as unknown as { code: string; full_name: string | null } | null;
                return (
                  <tr key={o.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2"><Link href={`/admin/orders/${o.id}`} className="font-bold text-[#0B1B3A] hover:underline" dir="ltr">{o.code}</Link></td>
                    <td className="px-3 py-2">{cu?.full_name ?? cu?.code}</td>
                    <td className="max-w-56 truncate px-3 py-2 text-slate-600">{o.title}</td>
                    <td className="px-3 py-2">
                      {o.status === "cancelled" ? <Badge tone="red">ملغي</Badge>
                        : o.status === "completed" ? <Badge tone="green">{stageName(o.stage)}</Badge>
                        : <Badge tone={o.status === "awaiting_payment" ? "amber" : "blue"}>{stageName(o.stage) || STATUS_AR[o.status]}</Badge>}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">{when(o.stage_at)}</td>
                    <td className="px-3 py-2 font-bold">{o.total_amount !== null ? sar(o.total_amount) : "—"}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{when(o.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
