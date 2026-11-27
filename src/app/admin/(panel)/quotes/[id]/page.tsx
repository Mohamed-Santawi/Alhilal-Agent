import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth/staff";
import { db } from "@/lib/supabase";
import { portName, serviceName, type Carton } from "@/lib/shipping/pricing";
import { Badge, Card, KIND_AR, QUOTE_STATUS, sar, stamp } from "../../bits";
import { fclOffer, orderFromQuote } from "../../../panel-actions";
import { ActionForm, SaveButton } from "../../../ui";

const input = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#D4AF5A] focus:ring-2 focus:ring-[#D4AF5A]/30";

type Item = { category_ar: string; product: string; cartons: Carton[]; photos: string[] };
type Line = { name_ar: string; value: number; kind?: string; amount?: number };

export default async function QuoteDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireStaff();
  const { id } = await params;
  const r = await db().from("shipping_quotes").select("*, customers(id, code, full_name, wa_id, conversations(id))").eq("id", id).maybeSingle();
  if (!r.data) notFound();
  const q = r.data;
  const cu = q.customers as { code: string; full_name: string | null; wa_id: string; conversations: { id: string } | { id: string }[] | null };
  const convId = Array.isArray(cu.conversations) ? cu.conversations[0]?.id : cu.conversations?.id;
  const items: Item[] = (q.items as Item[] | null) ?? [];
  const b = (q.breakdown ?? {}) as Record<string, unknown>;

  // Private bucket → short-lived signed links
  const paths = items.flatMap((i) => i.photos ?? []).concat(!items.length && q.photo_path ? [q.photo_path] : []);
  const signed = paths.length ? await db().storage.from("quote-photos").createSignedUrls(paths, 3600) : { data: [] };
  const url = (p: string) => signed.data?.find((x) => x.path === p)?.signedUrl ?? undefined;
  const [label, tone] = QUOTE_STATUS[q.status] ?? [q.status, "gray"];
  const order = (await db().from("orders").select("id, code").eq("quote_id", id).maybeSingle()).data;
  const containers = (q.containers as { key: string; count: number; name_ar?: string }[] | null) ?? [];
  const named = (b.containers as { name_ar: string; count: number }[] | undefined) ?? containers.map((c) => ({ name_ar: c.key, count: c.count }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/admin/quotes" className="text-xs text-slate-400 hover:text-slate-600">→ التسعيرات</Link>
          <h1 className="text-xl font-extrabold text-[#0B1B3A]"><span dir="ltr">{q.code}</span> · {KIND_AR[q.kind] ?? q.kind} <Badge tone={tone}>{label}</Badge></h1>
          <p className="text-sm text-slate-500">{stamp(q.created_at)} · {cu.full_name ?? "عميل غير مسجّل"} ({cu.code}) <span dir="ltr">+{cu.wa_id}</span></p>
        </div>
        <div className="flex gap-2">
          {order && <Link href={`/admin/orders/${order.id}`} className="rounded-lg bg-[#D4AF5A] px-4 py-2 text-sm font-bold text-[#0B1B3A]">📦 الطلب {order.code}</Link>}
          {convId && <Link href={`/admin/inbox/${convId}`} className="rounded-lg bg-[#0B1B3A] px-4 py-2 text-sm font-bold text-[#E9C77B]">💬 محادثة العميل</Link>}
        </div>
      </div>

      {q.kind === "fcl" && q.status !== "accepted" && (
        <Card title={q.offered_at ? "عرض السعر (أُرسل — يمكنك إرسال عرض معدّل)" : "إرسال عرض سعر للعميل"}>
          {q.offered_at && <p className="mb-3 text-sm text-slate-600">آخر عرض: <b>{sar(q.total)} ريال</b> شامل الضريبة · {stamp(q.offered_at)} · صالح حتى {stamp(q.valid_until)}</p>}
          <ActionForm action={fclOffer} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="quote_id" value={id} />
            <label className="w-48"><span className="mb-1 block text-xs text-slate-500">السعر قبل الضريبة (ريال)</span><input name="base" inputMode="decimal" dir="ltr" defaultValue={q.subtotal ?? ""} className={input} /></label>
            <label className="min-w-64 flex-1"><span className="mb-1 block text-xs text-slate-500">ملاحظة تظهر للعميل (اختياري)</span><input name="note" defaultValue={q.offer_note ?? ""} placeholder="مثال: يشمل التخليص والنقل إلى المدينة" className={input} /></label>
            <SaveButton label="إرسال العرض على واتساب" />
          </ActionForm>
          <p className="mt-2 text-xs text-slate-500">يصل العميل العرض مع زر «قبول العرض». عند قبوله يُنشأ الطلب تلقائياً.</p>
        </Card>
      )}

      {q.kind !== "fcl" && !order && q.total !== null && q.status !== "expired" && (
        <Card>
          <ActionForm action={orderFromQuote} confirm="إنشاء طلب من هذه التسعيرة وإبلاغ العميل؟" className="flex flex-wrap items-center justify-between gap-3">
            <input type="hidden" name="quote_id" value={id} />
            <p className="text-sm text-slate-600">{q.status === "accepted" ? "العميل قبل التسعيرة، ولم يُنشأ طلب بعد." : "العميل لم يضغط «إكمال الطلب» بعد. يمكنك إنشاء الطلب نيابةً عنه بعد الاتفاق معه."}</p>
            <SaveButton label="إنشاء طلب" />
          </ActionForm>
        </Card>
      )}

      {q.kind === "fcl" && (
        <Card title="طلب الحاوية">
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <KV k="الحاوية" v={named.map((c) => `${c.name_ar} × ${c.count}`).join("، ")} />
            <KV k="ميناء الوصول" v={portName(q.dest_port)} />
            <KV k="مدينة الاستلام" v={q.city ?? "—"} />
            <KV k="الخدمات المطلوبة" v={((q.services as string[] | null) ?? []).map(serviceName).join("، ") || "الشحن فقط"} />
            <KV k="عنوان المصنع في الصين" v={q.factory_address ?? "—"} wide />
            {q.notes && <KV k="ملاحظات العميل" v={q.notes} wide />}
          </dl>
        </Card>
      )}

      <Card title="المنتجات">
        <div className="space-y-4">
          {items.map((it, i) => (
            <div key={i} className="rounded-xl border border-slate-200 p-3">
              <p className="font-bold text-[#0B1B3A]">{i + 1}. {it.product} <span className="text-sm font-normal text-slate-500">({it.category_ar})</span></p>
              {!!it.photos?.length && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {it.photos.map((p) => url(p) && (
                    <a key={p} href={url(p)} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url(p)} alt={it.product} className="h-28 w-28 rounded-lg object-cover" />
                    </a>
                  ))}
                </div>
              )}
              <table className="mt-2 w-full text-xs">
                <thead className="text-slate-500"><tr>{["العدد", "الطول", "العرض", "الارتفاع", "الوزن/كرتونة"].map((h) => <th key={h} className="py-1 text-right font-medium">{h}</th>)}</tr></thead>
                <tbody>{it.cartons.map((c, j) => <tr key={j}><td>{c.qty}</td><td>{c.l} سم</td><td>{c.w} سم</td><td>{c.h} سم</td><td>{c.kg} كجم</td></tr>)}</tbody>
              </table>
            </div>
          ))}
          {!items.length && <p className="text-sm text-slate-500">تسعيرة قديمة بدون تفاصيل المنتجات.</p>}
        </div>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
          <KV k="الكراتين" v={String(b.cartons_count ?? "—")} />
          <KV k="الحجم" v={`${Number(q.cbm ?? 0).toFixed(3)} CBM`} />
          <KV k="الوزن الفعلي" v={`${q.actual_kg ?? "—"} كجم`} />
        </dl>
      </Card>

      {q.total !== null && (
        <Card title="التسعيرة">
          <dl className="space-y-1.5 text-sm">
            <KV k="التوصيل إلى" v={`${q.city ?? "—"}${q.is_remote ? " (منطقة نائية)" : ""}`} />
            {q.kind === "air" && <KV k="الوزن المحتسب" v={`${b.measured ?? q.chargeable} كجم (الحجمي ${b.volumetric_kg ?? "—"})`} />}
            <KV k="الكمية المحتسبة" v={`${q.chargeable} ${b.unit === "CBM" ? "CBM" : "كجم"}${b.min_qty_applied ? " (الحد الأدنى)" : ""}`} />
            <KV k="سعر الوحدة" v={`${sar((b.rate as { unit_price?: number } | undefined)?.unit_price)} ريال${items.length > 1 ? ` (${b.pricing === "per_item" ? "كل منتج بسعره" : `بسعر ${(b.rate as { category_ar?: string } | undefined)?.category_ar ?? "النوع الأعلى"}`})` : ""}`} />
            <KV k="سعر الشحن" v={`${sar(b.freight)} ريال`} />
            {((b.surcharges as Line[] | undefined) ?? []).map((s, i) => <KV key={i} k={s.name_ar} v={`${sar(s.value)} ريال`} />)}
            {!!(b.remote as { value?: number } | undefined)?.value && <KV k="التوصيل للمناطق النائية" v={`${sar((b.remote as { value: number }).value)} ريال`} />}
            <KV k="قبل الضريبة" v={`${sar(q.subtotal)} ريال`} />
            <KV k="الضريبة" v={`${sar(q.vat_amount)} ريال`} />
            <KV k="الإجمالي" v={`${sar(q.total)} ريال`} />
            <KV k="صالحة حتى" v={stamp(q.valid_until)} />
          </dl>
        </Card>
      )}
    </div>
  );
}

function KV({ k, v, wide }: { k: string; v: string; wide?: boolean }) {
  return <div className={`flex justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 ${wide ? "sm:col-span-2" : ""}`}><dt className="text-slate-500">{k}</dt><dd className="text-left font-bold text-[#0B1B3A]">{v}</dd></div>;
}
