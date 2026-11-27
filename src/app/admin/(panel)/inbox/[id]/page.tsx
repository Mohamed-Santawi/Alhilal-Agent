import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth/staff";
import { db } from "@/lib/supabase";
import { TASK_TYPE_AR } from "@/lib/bot/tasks";
import { newServiceOrder, returnToBot, sendReply, takeOver } from "../../../panel-actions";
import { ActionForm, SaveButton } from "../../../ui";
import { AutoRefresh, ReplyBox, ScrollToEnd } from "../../../live";
import { Badge, Card, KIND_AR, QUOTE_STATUS, sar, stamp, TZ } from "../../bits";

type Msg = { id: string; direction: "in" | "out"; type: string; body: string | null; payload: Record<string, unknown> | null; created_at: string; sent_by_staff: string | null };

export default async function Chat({ params }: { params: Promise<{ id: string }> }) {
  await requireStaff();
  const { id } = await params;

  const conv = await db().from("conversations").select("*, customers(*)").eq("id", id).maybeSingle();
  if (!conv.data) notFound();
  const c = conv.data.customers as Record<string, string | boolean | null>;

  const [msgs, addr, tasks, quotes, staff, orders, services] = await Promise.all([
    db().from("messages").select("id, direction, type, body, payload, created_at, sent_by_staff").eq("conversation_id", id).order("created_at", { ascending: false }).limit(200),
    db().from("addresses").select("*").eq("customer_id", conv.data.customer_id).order("is_default", { ascending: false }).limit(1).maybeSingle(),
    db().from("tasks").select("id, type, title, status, created_at").eq("customer_id", conv.data.customer_id).in("status", ["open", "in_progress"]).order("created_at", { ascending: false }),
    db().from("shipping_quotes").select("id, code, kind, status, total, created_at").eq("customer_id", conv.data.customer_id).order("created_at", { ascending: false }).limit(8),
    db().from("staff").select("id, full_name"),
    db().from("orders").select("id, code, title, status, stage, total_amount, order_stages(name_ar)").eq("customer_id", conv.data.customer_id).order("created_at", { ascending: false }).limit(8),
    db().from("services").select("key, name_ar, base_price").eq("active", true).order("menu_group").order("sort_order"),
  ]);
  // Opening the chat marks it as read
  await db().from("conversations").update({ staff_seen_at: new Date().toISOString() }).eq("id", id);

  const messages = ((msgs.data ?? []) as Msg[]).reverse();
  const staffName = (sid: string | null) => staff.data?.find((s) => s.id === sid)?.full_name;
  const human = conv.data.mode === "human";
  const humanUntil = typeof conv.data.state?.human_until === "string" ? conv.data.state.human_until : null;
  const windowOpen = !!conv.data.last_inbound_at && Date.now() - new Date(conv.data.last_inbound_at).getTime() < 24 * 3600_000;
  const a = addr.data;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <AutoRefresh ms={8000} />

      {/* ------------------------------------------------ chat */}
      <section className="flex h-[calc(100dvh-140px)] min-h-[480px] flex-col overflow-hidden rounded-2xl bg-white shadow-sm">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div>
            <Link href="/admin/inbox" className="text-xs text-slate-400 hover:text-slate-600">→ المحادثات</Link>
            <p className="font-extrabold text-[#0B1B3A]">{(c.full_name as string) ?? "عميل غير مسجّل"} <span className="text-sm font-normal text-slate-400" dir="ltr">+{c.wa_id as string}</span></p>
          </div>
          <div className="flex items-center gap-2">
            {human
              ? <Badge tone="navy">👤 مع موظف{humanUntil ? ` حتى ${stamp(humanUntil)}` : ""}</Badge>
              : <Badge>🤖 الرد الآلي يعمل</Badge>}
            {human ? (
              <ActionForm action={returnToBot} confirm="إرجاع المحادثة للرد الآلي وإغلاق طلبات التحدث مع موظف؟" className="flex items-center gap-2">
                <input type="hidden" name="conversation_id" value={id} />
                <SaveButton label="إرجاع للبوت 🤖" variant="ghost" />
              </ActionForm>
            ) : (
              <ActionForm action={takeOver} className="flex items-center gap-2">
                <input type="hidden" name="conversation_id" value={id} />
                <SaveButton label="استلام المحادثة 👤" variant="ghost" />
              </ActionForm>
            )}
          </div>
        </header>

        <div className="flex-1 space-y-2 overflow-y-auto bg-[#F4F1EA] px-3 py-4">
          {messages.length === 0 && <p className="text-center text-sm text-slate-500">لا توجد رسائل.</p>}
          {messages.map((m, i) => {
            const day = new Date(m.created_at).toLocaleDateString("en-GB", { timeZone: TZ });
            const showDay = i === 0 || new Date(messages[i - 1].created_at).toLocaleDateString("en-GB", { timeZone: TZ }) !== day;
            const out = m.direction === "out";
            return (
              <div key={m.id}>
                {showDay && <p className="my-3 text-center"><span className="rounded-full bg-white/80 px-3 py-1 text-xs text-slate-500">{day}</span></p>}
                <div className={`flex ${out ? "justify-start" : "justify-end"}`}>
                  <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm ${out ? (m.sent_by_staff ? "bg-[#DCEBFF]" : "bg-white") : "bg-[#DCF8C6]"}`}>
                    {out && <p className="mb-0.5 text-[11px] font-bold text-slate-500">{m.sent_by_staff ? `👤 ${staffName(m.sent_by_staff) ?? "موظف"}` : "🤖 البوت"}</p>}
                    <Body m={m} />
                    <p className="mt-1 text-left text-[10px] text-slate-400">{new Date(m.created_at).toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" })}</p>
                  </div>
                </div>
              </div>
            );
          })}
          <ScrollToEnd dep={messages.at(-1)?.id ?? ""} />
        </div>

        <footer className="border-t border-slate-100 p-3">
          <ReplyBox action={sendReply} conversationId={id} disabled={!windowOpen}
            reason="مرّ أكثر من 24 ساعة على آخر رسالة من العميل، وواتساب لا يسمح بإرسال رسالة حرة حتى يراسلكم العميل مجدداً." />
        </footer>
      </section>

      {/* ------------------------------------------------ side panel */}
      <aside className="space-y-4">
        <Card title="العميل">
          <dl className="space-y-1.5 text-sm">
            <Row k="رقم العميل" v={c.code as string} />
            <Row k="الاسم" v={(c.full_name as string) ?? "—"} />
            <Row k="الجوال" v={`+${c.wa_id}`} ltr />
            {c.type && <Row k="النوع" v={c.type === "company" ? "شركة / مؤسسة" : "فرد"} />}
            {c.company_name && <Row k="الشركة" v={c.company_name as string} />}
            {c.cr_number && <Row k="السجل التجاري" v={c.cr_number as string} ltr />}
            {c.vat_number && <Row k="الرقم الضريبي" v={c.vat_number as string} ltr />}
            {c.email && <Row k="البريد" v={c.email as string} ltr />}
            <Row k="التسجيل" v={c.registration_complete ? "مكتمل ✓" : "غير مكتمل"} />
          </dl>
          {a && (
            <p className="mt-3 rounded-lg bg-slate-50 p-2 text-xs leading-6 text-slate-600">
              📍 {[a.city, a.district, a.street, a.building_no && `مبنى ${a.building_no}`, a.postal_code, a.short_address].filter(Boolean).join("، ")}
              {a.recipient_name && <><br />المستلم: {a.recipient_name} {a.recipient_phone && <span dir="ltr">({a.recipient_phone})</span>}</>}
            </p>
          )}
        </Card>

        <Card title="الطلبات المفتوحة">
          {!tasks.data?.length && <p className="text-sm text-slate-500">لا توجد.</p>}
          <ul className="space-y-2">
            {tasks.data?.map((t) => (
              <li key={t.id} className="rounded-lg bg-slate-50 p-2 text-sm">
                <Badge tone="gold">{TASK_TYPE_AR[t.type] ?? t.type}</Badge>
                <p className="mt-1 text-xs leading-5 text-slate-600">{t.title}</p>
              </li>
            ))}
          </ul>
          <Link href="/admin/tasks" className="mt-2 block text-xs font-bold text-[#B8923B]">كل المهام ←</Link>
        </Card>

        <Card title="الطلبات">
          {!orders.data?.length && <p className="text-sm text-slate-500">لا توجد.</p>}
          <ul className="space-y-1">
            {orders.data?.map((o) => (
              <li key={o.id}>
                <Link href={`/admin/orders/${o.id}`} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50">
                  <b dir="ltr">{o.code}</b>
                  {o.status === "cancelled" ? <Badge tone="red">ملغي</Badge> : <Badge tone={o.status === "completed" ? "green" : "blue"}>{(o.order_stages as unknown as { name_ar: string } | null)?.name_ar ?? o.status}</Badge>}
                </Link>
              </li>
            ))}
          </ul>
          <details className="mt-3 rounded-lg bg-slate-50 p-2">
            <summary className="cursor-pointer text-sm font-bold text-[#B8923B]">+ إنشاء طلب خدمة</summary>
            <ActionForm action={newServiceOrder} className="mt-2 space-y-2">
              <input type="hidden" name="customer_id" value={conv.data.customer_id} />
              <select name="service_key" className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm">
                <option value="">اختر الخدمة</option>
                {services.data?.filter((x) => !x.key.startsWith("shipping_")).map((x) => <option key={x.key} value={x.key}>{x.name_ar}{x.base_price ? ` (${x.base_price})` : ""}</option>)}
              </select>
              <input name="title" placeholder="وصف مختصر (يظهر للعميل)" maxLength={200} className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm" />
              <input name="base" inputMode="decimal" dir="ltr" placeholder="المبلغ قبل الضريبة" className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm" />
              <SaveButton label="إنشاء وإبلاغ العميل" />
            </ActionForm>
          </details>
        </Card>

        <Card title="التسعيرات">
          {!quotes.data?.length && <p className="text-sm text-slate-500">لا توجد.</p>}
          <ul className="space-y-1">
            {quotes.data?.map((q) => {
              const [label, tone] = QUOTE_STATUS[q.status] ?? [q.status, "gray"];
              return (
                <li key={q.id}>
                  <Link href={`/admin/quotes/${q.id}`} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50">
                    <span><b dir="ltr">{q.code}</b> <span className="text-xs text-slate-500">{KIND_AR[q.kind] ?? q.kind}</span></span>
                    <span className="flex items-center gap-1">{q.total !== null && <span className="text-xs">{sar(q.total)}</span>}<Badge tone={tone}>{label}</Badge></span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      </aside>
    </div>
  );
}

function Row({ k, v, ltr }: { k: string; v: string; ltr?: boolean }) {
  return <div className="flex justify-between gap-2"><dt className="text-slate-500">{k}</dt><dd className="font-bold text-[#0B1B3A]" dir={ltr ? "ltr" : undefined}>{v}</dd></div>;
}

function Body({ m }: { m: Msg }) {
  const media = (k: string) => (m.payload?.[k] as { id?: string; caption?: string; filename?: string } | undefined);
  if (m.direction === "in" && m.type === "image" && media("image")?.id) {
    const im = media("image")!;
    return (
      <>
        <a href={`/admin/media/${im.id}`} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/admin/media/${im.id}`} alt="صورة من العميل" className="max-h-64 rounded-lg" />
        </a>
        {im.caption && <p className="mt-1 whitespace-pre-wrap">{im.caption}</p>}
      </>
    );
  }
  if (m.direction === "in" && m.type === "audio" && media("audio")?.id) {
    return <audio controls src={`/admin/media/${media("audio")!.id}`} className="max-w-full" />;
  }
  if (m.direction === "in" && (m.type === "document" || m.type === "video") && media(m.type)?.id) {
    const d = media(m.type)!;
    return <a href={`/admin/media/${d.id}`} target="_blank" rel="noreferrer" className="font-bold text-blue-700 underline">{m.type === "video" ? "🎬 فيديو" : `📄 ${d.filename ?? "ملف"}`}</a>;
  }
  if (m.direction === "in" && m.type === "interactive") return <p>اختار: <b>{m.body}</b></p>;
  if (m.direction === "in" && m.type === "location") return <p>📍 موقع</p>;
  return <p className="whitespace-pre-wrap break-words leading-6">{m.body ?? `[${m.type}]`}</p>;
}
