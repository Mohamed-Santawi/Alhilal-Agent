import Link from "next/link";
import { requireStaff } from "@/lib/auth/staff";
import { db } from "@/lib/supabase";
import { Badge, Empty, KIND_AR, PageTitle, QUOTE_STATUS, sar, Tabs, when } from "../bits";

export default async function Quotes({ searchParams }: { searchParams: Promise<{ k?: string; s?: string }> }) {
  await requireStaff();
  const { k = "all", s = "all" } = await searchParams;
  let q = db().from("shipping_quotes")
    .select("id, code, kind, status, total, city, is_remote, items, cartons, created_at, customers(code, full_name, wa_id)")
    .order("created_at", { ascending: false }).limit(150);
  if (k !== "all") q = q.eq("kind", k);
  if (s !== "all") q = q.eq("status", s);
  const { data, error } = await q;
  if (error) throw error;

  return (
    <>
      <PageTitle title="التسعيرات وطلبات الحاويات" hint="كل تسعيرة حسبها عميل من الحاسبة أو من المحادثة، وكل طلب حاوية." />
      <div className="mb-4 flex flex-wrap gap-2">
        <Tabs base="/admin/quotes" param="s" value={s} keep={{ k }} items={[["all", "الكل"], ["accepted", "طلبات مؤكدة"], ["requested", "طلبات حاويات"], ["estimate", "تسعيرات فقط"], ["expired", "منتهية"]]} />
        <Tabs base="/admin/quotes" param="k" value={k} keep={{ s }} items={[["all", "كل الأنواع"], ["air", "جوي"], ["lcl", "LCL"], ["fcl", "حاويات"]]} />
      </div>
      {!data?.length ? <Empty>لا توجد تسعيرات.</Empty> : (
        <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>{["الرقم", "العميل", "النوع", "المنتجات", "المدينة", "الإجمالي", "الحالة", "التاريخ"].map((h) => <th key={h} className="px-3 py-2 text-right font-medium">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.map((x) => {
                const cu = x.customers as unknown as { code: string; full_name: string | null } | null;
                const items = (x.items as { product: string }[] | null) ?? [];
                const [label, tone] = QUOTE_STATUS[x.status] ?? [x.status, "gray"];
                return (
                  <tr key={x.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2"><Link href={`/admin/quotes/${x.id}`} className="font-bold text-[#0B1B3A] underline-offset-2 hover:underline" dir="ltr">{x.code}</Link></td>
                    <td className="px-3 py-2">{cu?.full_name ?? cu?.code ?? "—"}</td>
                    <td className="px-3 py-2">{KIND_AR[x.kind] ?? x.kind}</td>
                    <td className="max-w-48 truncate px-3 py-2 text-slate-600">{items.map((i) => i.product).join("، ") || "—"}</td>
                    <td className="px-3 py-2">{x.city ?? "—"} {x.is_remote && <Badge tone="amber">نائية</Badge>}</td>
                    <td className="px-3 py-2 font-bold">{x.total !== null ? sar(x.total) : "—"}</td>
                    <td className="px-3 py-2"><Badge tone={tone}>{label}</Badge></td>
                    <td className="px-3 py-2 text-xs text-slate-500">{when(x.created_at)}</td>
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
