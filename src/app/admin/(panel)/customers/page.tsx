import Link from "next/link";
import { requireStaff } from "@/lib/auth/staff";
import { db } from "@/lib/supabase";
import { Badge, Empty, PageTitle, safeQ, SearchBox, Tabs, when } from "../bits";

export default async function Customers({ searchParams }: { searchParams: Promise<{ q?: string; r?: string }> }) {
  await requireStaff();
  const { q, r = "all" } = await searchParams;
  const term = safeQ(q);
  let query = db().from("customers")
    .select("id, code, full_name, wa_id, type, company_name, registration_complete, created_at, conversations(id), shipping_quotes(count)")
    .order("created_at", { ascending: false }).limit(200);
  if (r === "registered") query = query.eq("registration_complete", true);
  if (r === "guest") query = query.eq("registration_complete", false);
  if (term) query = query.or(`full_name.ilike.*${term}*,wa_id.ilike.*${term}*,code.ilike.*${term}*,company_name.ilike.*${term}*`);
  const { data, error } = await query;
  if (error) throw error;

  return (
    <>
      <PageTitle title="العملاء" hint="كل من راسل البوت. اضغط على العميل لفتح محادثته وبياناته.">
        <SearchBox base="/admin/customers" q={q} placeholder="الاسم، الجوال، رقم العميل" hidden={{ r }} />
      </PageTitle>
      <div className="mb-4"><Tabs base="/admin/customers" param="r" value={r} keep={{ q }} items={[["all", "الكل"], ["registered", "المسجّلون"], ["guest", "غير مسجّلين"]]} /></div>
      {!data?.length ? <Empty>لا يوجد عملاء.</Empty> : (
        <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
          <table className="w-full min-w-[680px] text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>{["رقم العميل", "الاسم", "الجوال", "النوع", "التسجيل", "التسعيرات", "أول تواصل"].map((h) => <th key={h} className="px-3 py-2 text-right font-medium">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.map((c) => {
                const conv = c.conversations as unknown as { id: string } | { id: string }[] | null;
                const cid = Array.isArray(conv) ? conv[0]?.id : conv?.id;
                const quotes = (c.shipping_quotes as unknown as { count: number }[] | null)?.[0]?.count ?? 0;
                return (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-bold" dir="ltr">{cid ? <Link href={`/admin/inbox/${cid}`} className="text-[#0B1B3A] hover:underline">{c.code}</Link> : c.code}</td>
                    <td className="px-3 py-2">{c.full_name ?? "—"}{c.company_name && <span className="block text-xs text-slate-500">{c.company_name}</span>}</td>
                    <td className="px-3 py-2" dir="ltr">+{c.wa_id}</td>
                    <td className="px-3 py-2">{c.type === "company" ? "شركة" : c.type === "individual" ? "فرد" : "—"}</td>
                    <td className="px-3 py-2">{c.registration_complete ? <Badge tone="green">مسجّل</Badge> : <Badge>زائر</Badge>}</td>
                    <td className="px-3 py-2">{quotes}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{when(c.created_at)}</td>
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
