import { db } from "../supabase";
import { wa, WaApiError } from "../whatsapp/send";
import { audit, logOutbound } from "../bot/repo";
import { getShippingSettings } from "../shipping/repo";

export type Track = "shipping" | "service";
export type Stage = { key: string; track: Track; name_ar: string; message_ar: string | null; notify: boolean; sort_order: number; active: boolean };
export type Order = {
  id: string; code: string; customer_id: string; service_key: string; status: string; track: Track; stage: string | null;
  title: string | null; base_amount: number | null; vat_rate: number; vat_amount: number | null; total_amount: number | null;
  quote_id: string | null; created_at: string;
};

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const sar = (n: unknown) => Number(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const KIND_AR: Record<string, string> = { air: "شحن جوي", lcl: "شحن بحري جزئي LCL", fcl: "شحن حاوية كاملة" };
export const STATUS_AR: Record<string, string> = {
  awaiting_payment: "بانتظار الدفع", in_progress: "قيد التنفيذ", completed: "مكتمل", cancelled: "ملغي", paid: "مدفوع",
  draft: "مسودة", pending_review: "قيد المراجعة", pending_quote: "بانتظار التسعير",
};

export async function listStages(track?: Track, includeInactive = false): Promise<Stage[]> {
  let q = db().from("order_stages").select("*").order("track").order("sort_order");
  if (track) q = q.eq("track", track);
  if (!includeInactive) q = q.eq("active", true);
  const r = await q;
  if (r.error) throw r.error;
  return r.data as Stage[];
}

/** Coarse order status follows the stage: first = awaiting payment, last = completed, anything else = in progress. */
function statusFor(stages: Stage[], key: string) {
  if (key === stages[0]?.key) return "awaiting_payment";
  if (key === stages.at(-1)?.key) return "completed";
  return "in_progress";
}

/** Sends a WhatsApp text (or buttons) to the customer and logs it. Returns false if WhatsApp refused (e.g. outside the 24h window). */
export async function messageCustomer(customerId: string, text: string, buttons?: { id: string; title: string }[]): Promise<{ ok: boolean; reason?: string }> {
  try {
    const [cust, conv] = await Promise.all([
      db().from("customers").select("wa_id").eq("id", customerId).single(),
      db().from("conversations").select("id").eq("customer_id", customerId).maybeSingle(),
    ]);
    const r = buttons ? await wa.buttons(cust.data!.wa_id, text, buttons) : await wa.text(cust.data!.wa_id, text);
    if (conv.data) await logOutbound(conv.data.id, r.messages?.[0]?.id, buttons ? "interactive" : "text", text);
    return { ok: true };
  } catch (e) {
    const code = e instanceof WaApiError ? e.code : undefined;
    console.warn("[orders] customer message failed", code ?? e);
    return {
      ok: false,
      reason: code === 131047 ? "مرّ أكثر من 24 ساعة على آخر رسالة من العميل (يلزم قالب رسالة معتمد)"
        : code === 131030 ? "رقم العميل غير مضاف لقائمة الأرقام المسموح بها في الرقم التجريبي"
        : "تعذّر إرسال رسالة واتساب",
    };
  }
}

function createdMessage(o: Order, stage?: Stage) {
  return [
    `🧾 *تم إنشاء طلبك* — ${o.code}`,
    ``,
    o.title ? `الطلب: ${o.title}` : null,
    o.total_amount !== null ? `المبلغ: ${sar(o.total_amount)} ريال شامل الضريبة` : null,
    stage ? `الحالة: ${stage.name_ar}` : null,
    ``,
    stage?.message_ar ?? "سيتواصل معك فريقنا بالتفاصيل.",
    ``,
    `يمكنك متابعة طلبك في أي وقت من «طلباتي» في القائمة.`,
  ].filter((x) => x !== null).join("\n");
}

/** Customer accepted a priced quote (air/LCL) or a container offer (FCL) → order. Idempotent per quote. */
export async function createOrderFromQuote(quoteId: string, actor: string): Promise<{ order: Order; created: boolean; notified: boolean }> {
  const existing = await db().from("orders").select("*").eq("quote_id", quoteId).maybeSingle();
  if (existing.data) return { order: existing.data as Order, created: false, notified: true };

  const q = await db().from("shipping_quotes").select("*").eq("id", quoteId).single();
  if (q.error) throw q.error;
  if (q.data.total === null) throw new Error("quote has no price");
  const stages = await listStages("shipping");
  const first = stages[0];
  const products = ((q.data.items as { product: string }[] | null) ?? []).map((i) => i.product).join("، ");
  const vat_rate = Number((q.data.breakdown as { vat_rate?: number } | null)?.vat_rate ?? 15);

  const ins = await db().from("orders").insert({
    customer_id: q.data.customer_id,
    service_key: q.data.kind === "fcl" ? "shipping_fcl" : "shipping_lcl",
    quote_id: quoteId,
    track: "shipping",
    stage: first?.key ?? null,
    stage_at: new Date().toISOString(),
    status: "awaiting_payment",
    title: `${KIND_AR[q.data.kind] ?? "شحن"}${products ? ` — ${products}` : ""}`.slice(0, 200),
    base_amount: q.data.subtotal, vat_rate, vat_amount: q.data.vat_amount, total_amount: q.data.total,
    customer_approved_at: new Date().toISOString(),
  }).select("*").single();
  if (ins.error) {
    // Two accept clicks at the same moment: the unique index lets only one through
    const again = await db().from("orders").select("*").eq("quote_id", quoteId).maybeSingle();
    if (again.data) return { order: again.data as Order, created: false, notified: true };
    throw ins.error;
  }
  const order = ins.data as Order;
  await db().from("order_events").insert({ order_id: order.id, to_status: "awaiting_payment", to_stage: first?.key, actor, note: `من التسعيرة ${q.data.code}` });
  await audit(actor, "order.created", "orders", order.id, { code: order.code, quote: q.data.code });
  const sent = await messageCustomer(order.customer_id, createdMessage(order, first));
  return { order, created: true, notified: sent.ok };
}

/** Staff creates an order for a non-shipping service (SABER, inspection, legal…). */
export async function createServiceOrder(p: { customerId: string; serviceKey: string; title: string; base: number; staffId: string }) {
  const settings = await getShippingSettings();
  const stages = await listStages("service");
  const first = stages[0];
  const vat_amount = r2((p.base * settings.vat_rate) / 100);
  const ins = await db().from("orders").insert({
    customer_id: p.customerId, service_key: p.serviceKey, track: "service",
    stage: first?.key ?? null, stage_at: new Date().toISOString(), status: "awaiting_payment",
    title: p.title.slice(0, 200), base_amount: p.base, vat_rate: settings.vat_rate, vat_amount, total_amount: r2(p.base + vat_amount),
    assigned_staff: p.staffId,
  }).select("*").single();
  if (ins.error) throw ins.error;
  const order = ins.data as Order;
  await db().from("order_events").insert({ order_id: order.id, to_status: "awaiting_payment", to_stage: first?.key, actor: p.staffId });
  await audit(p.staffId, "order.created", "orders", order.id, { code: order.code, service: p.serviceKey });
  const sent = await messageCustomer(order.customer_id, createdMessage(order, first));
  return { order, notified: sent.ok, reason: sent.reason };
}

/** Moves an order to a stage of its track, logs it, and tells the customer (if the stage notifies). */
export async function setStage(orderId: string, stageKey: string, actor: string, opts: { note?: string; notify?: boolean } = {}) {
  const o = await db().from("orders").select("*").eq("id", orderId).single();
  if (o.error) throw o.error;
  const order = o.data as Order;
  if (order.status === "cancelled") return { ok: false as const, error: "الطلب ملغي" };
  const stages = await listStages(order.track);
  const stage = stages.find((s) => s.key === stageKey);
  if (!stage) return { ok: false as const, error: "المرحلة غير صحيحة لهذا الطلب" };
  if (stage.key === order.stage) return { ok: false as const, error: "الطلب في هذه المرحلة بالفعل" };

  const status = statusFor(stages, stage.key);
  const up = await db().from("orders").update({ stage: stage.key, stage_at: new Date().toISOString(), status }).eq("id", orderId);
  if (up.error) throw up.error;

  let notified: boolean | null = null, reason: string | undefined;
  if (opts.notify !== false && stage.notify) {
    const text = [
      `📦 *تحديث طلبك* — ${order.code}`,
      `الحالة: *${stage.name_ar}*`,
      ``,
      stage.message_ar ?? "",
      opts.note ? `\nملاحظة: ${opts.note}` : "",
    ].join("\n").replace(/\n{3,}/g, "\n\n").trim();
    const sent = await messageCustomer(order.customer_id, text);
    notified = sent.ok; reason = sent.reason;
  }
  await db().from("order_events").insert({
    order_id: orderId, from_status: order.status, to_status: status, from_stage: order.stage, to_stage: stage.key,
    actor, note: opts.note ?? null, notified,
  });
  await audit(actor, "order.stage", "orders", orderId, { to: stage.key, notified });
  return { ok: true as const, notified, reason, stage };
}

export async function cancelOrder(orderId: string, actor: string, reason: string, notify: boolean) {
  const o = await db().from("orders").select("*").eq("id", orderId).single();
  if (o.error) throw o.error;
  const order = o.data as Order;
  if (order.status === "cancelled") return { ok: false as const, error: "الطلب ملغي مسبقاً" };
  await db().from("orders").update({ status: "cancelled", cancelled_reason: reason || null }).eq("id", orderId);
  let notified: boolean | null = null, why: string | undefined;
  if (notify) {
    const sent = await messageCustomer(order.customer_id, `تم إلغاء طلبك *${order.code}*.${reason ? `\nالسبب: ${reason}` : ""}\n\nلأي استفسار يمكنك التحدث مع موظف من القائمة.`);
    notified = sent.ok; why = sent.reason;
  }
  await db().from("order_events").insert({ order_id: orderId, from_status: order.status, to_status: "cancelled", from_stage: order.stage, actor, note: reason || null, notified });
  await audit(actor, "order.cancelled", "orders", orderId, { reason });
  return { ok: true as const, notified, reason: why };
}

/** Staff prices a container request and sends the offer with an "accept" button. */
export async function sendFclOffer(quoteId: string, base: number, note: string, staffId: string) {
  const q = await db().from("shipping_quotes").select("*").eq("id", quoteId).single();
  if (q.error) throw q.error;
  if (q.data.kind !== "fcl") return { ok: false as const, error: "هذه ليست طلب حاوية" };
  if (q.data.status === "accepted") return { ok: false as const, error: "العميل قبل العرض مسبقاً" };
  const settings = await getShippingSettings();
  const vat_amount = r2((base * settings.vat_rate) / 100), total = r2(base + vat_amount);
  const valid_until = new Date(Date.now() + settings.quote_validity_days * 86_400_000).toISOString();

  const up = await db().from("shipping_quotes").update({
    subtotal: base, vat_amount, total, valid_until, status: "requested",
    offer_note: note || null, offered_at: new Date().toISOString(), offered_by: staffId,
  }).eq("id", quoteId);
  if (up.error) throw up.error;

  const b = q.data.breakdown as { containers?: { name_ar: string; count: number }[] } | null;
  const text = [
    `💼 *عرض سعر الحاوية* — ${q.data.code}`,
    ``,
    b?.containers?.length ? `الحاوية: ${b.containers.map((c) => `${c.name_ar} × ${c.count}`).join("، ")}` : null,
    `السعر قبل الضريبة: ${sar(base)} ريال`,
    `ضريبة القيمة المضافة ${settings.vat_rate}%: ${sar(vat_amount)} ريال`,
    `*الإجمالي: ${sar(total)} ريال*`,
    note ? `\n${note}` : null,
    ``,
    `العرض صالح حتى: ${new Date(valid_until).toLocaleDateString("en-GB", { timeZone: "Asia/Riyadh" })}`,
    `للموافقة اضغط «قبول العرض» 👇`,
  ].filter((x) => x !== null).join("\n");
  const sent = await messageCustomer(q.data.customer_id, text, [
    { id: `quote:go:${quoteId}`, title: "قبول العرض" },
    { id: "act:human", title: "التحدث مع موظف" },
  ]);
  await audit(staffId, "fcl.offer_sent", "shipping_quotes", quoteId, { base, total, notified: sent.ok });
  return { ok: true as const, notified: sent.ok, reason: sent.reason, total };
}

/** «طلباتي» text for WhatsApp. */
export async function customerOrdersText(customerId: string): Promise<string | null> {
  const [orders, stages] = await Promise.all([
    db().from("orders").select("code, title, status, stage, total_amount, created_at").eq("customer_id", customerId).order("created_at", { ascending: false }).limit(5),
    listStages(undefined, true),
  ]);
  if (!orders.data?.length) return null;
  const lines = orders.data.map((o) => {
    const st = o.status === "cancelled" ? "ملغي" : stages.find((s) => s.key === o.stage)?.name_ar ?? STATUS_AR[o.status] ?? o.status;
    return [`*${o.code}*`, o.title, `الحالة: ${st}`, o.total_amount !== null ? `المبلغ: ${sar(o.total_amount)} ريال` : null].filter(Boolean).join("\n");
  });
  return [`📋 *طلباتك* (آخر ${orders.data.length})`, ``, lines.join("\n\n"), ``, `لأي استفسار عن طلب، اكتب سؤالك أو اختر «التحدث مع موظف».`].join("\n");
}

/** Compact data for the AI agent. */
export async function customerOrdersData(customerId: string) {
  const [orders, stages] = await Promise.all([
    db().from("orders").select("id, code, title, status, stage, stage_at, total_amount, created_at").eq("customer_id", customerId).order("created_at", { ascending: false }).limit(10),
    listStages(undefined, true),
  ]);
  return (orders.data ?? []).map((o) => {
    const track = stages.filter((s) => s.track === stages.find((x) => x.key === o.stage)?.track);
    return {
      code: o.code, title: o.title,
      stage: o.status === "cancelled" ? "ملغي" : stages.find((s) => s.key === o.stage)?.name_ar ?? STATUS_AR[o.status],
      stage_since: o.stage_at,
      all_stages: track.map((s) => s.name_ar),
      total_sar_incl_vat: o.total_amount,
    };
  });
}
