import { publicBaseUrl } from "../env";
import { issueFormToken } from "../forms/tokens";
import { db } from "../supabase";
import { getQuote } from "../shipping/repo";
import { wa } from "../whatsapp/send";
import { audit, logOutbound, setState, type Conversation, type Customer } from "./repo";
import { sendMainMenu } from "./menu";

export const QUOTE_LINK_TTL_MIN = 24 * 60; // calculator link: reusable for a day
export const QUOTE_IDS = {
  open: "act:quote",
  again: "quote:new",
  proceed: (quoteId: string) => `quote:go:${quoteId}`,
};

async function say(customer: Customer, conv: Conversation, text: string) {
  const r = await wa.text(customer.wa_id, text);
  await logOutbound(conv.id, r.messages?.[0]?.id, "text", text);
}

/** Sends the link to the shipping price calculator. No registration needed. */
export async function sendQuoteLink(customer: Customer, conv: Conversation) {
  const base = publicBaseUrl();
  if (!base) return say(customer, conv, "حاسبة الأسعار غير متاحة حالياً، تقدر تكلم موظف من القايمة.");
  const token = await issueFormToken(customer.id, "quote", QUOTE_LINK_TTL_MIN);
  await say(customer, conv, [
    "🧮 *حاسبة أسعار الشحن*",
    "",
    "أدخل نوع البضاعة، وطريقة الشحن (بحري أو جوي)، وعدد الكراتين ومقاساتها ووزنها، ويطلع لك السعر فوراً.",
    "",
    link(base, token),
  ].join("\n"));
}
const link = (base: string, token: string) => `${base}/quote?t=${token}`;

/**
 * "كمّل الطلب" on a quote. Unregistered → remember the quote and start registration;
 * registered → accept it right away.
 */
export async function proceedWithQuote(
  customer: Customer, conv: Conversation, quoteId: string,
  startRegistration: (c: Customer, v: Conversation, intro: string) => Promise<unknown>,
) {
  const q = await getQuote(quoteId);
  if (!q || q.customer_id !== customer.id) return say(customer, conv, "التسعيرة غير موجودة. اعمل تسعيرة جديدة من القايمة.");

  if (!customer.registration_complete) {
    conv.state = { ...conv.state, pending_quote: quoteId };
    await setState(conv.id, conv.state);
    return startRegistration(customer, conv, `ممتاز 👍 عشان نكمل طلب الشحن بالتسعيرة *${q.code}*، محتاجين نسجل بياناتك مرة واحدة بس.`);
  }
  return acceptQuote(customer, conv, quoteId);
}

export async function acceptQuote(customer: Customer, conv: Conversation, quoteId: string) {
  const q = await getQuote(quoteId);
  if (!q || q.customer_id !== customer.id) return;

  if (q.status === "accepted") return say(customer, conv, `طلبك بالتسعيرة ${q.code} مستلم من قبل، وفريقنا هيتواصل معاك ✅`);
  if (new Date(q.valid_until) < new Date()) {
    await db().from("shipping_quotes").update({ status: "expired" }).eq("id", q.id);
    await say(customer, conv, `⏳ التسعيرة ${q.code} انتهت صلاحيتها لأن الأسعار بتتغير. هبعتلك الحاسبة تاني عشان تحسب بالأسعار الحالية.`);
    return sendQuoteLink(customer, conv);
  }

  await db().from("shipping_quotes").update({ status: "accepted", accepted_at: new Date().toISOString() }).eq("id", q.id);
  await db().from("tasks").insert({
    customer_id: customer.id,
    type: "shipping_quote",
    title: `طلب شحن من ${customer.full_name ?? customer.code} — ${q.code} — ${Number(q.total).toLocaleString("en-US")} ريال`,
    due_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
  });
  await audit(customer.id, "quote.accepted", "shipping_quotes", q.id, { code: q.code, total: q.total });
  await say(customer, conv, [
    `✅ تم استلام طلب الشحن بالتسعيرة *${q.code}*`,
    ``,
    `فريقنا هيتواصل معاك خلال 24 ساعة لتأكيد التفاصيل وخطوات الدفع وعنوان المستودع.`,
  ].join("\n"));
}

/** Runs after ANY registration path (Flow / web / chat): continue what the customer was doing. */
export async function onRegistered(customer: Customer) {
  const r = await db().from("conversations").select("*").eq("customer_id", customer.id).single();
  if (r.error) throw r.error;
  const conv = r.data as Conversation;
  const { pending_quote, pending_service, ...rest } = conv.state as Record<string, unknown>;

  if (pending_quote || pending_service) {
    conv.state = rest;
    await setState(conv.id, rest);
  }
  if (typeof pending_quote === "string") return acceptQuote(customer, conv, pending_quote);
  if (pending_service && typeof pending_service === "object") {
    const s = pending_service as { key: string; name: string };
    await say(customer, conv, `تمام، نكمل طلب *${s.name}* 👇\n(تنفيذ الخدمة هيتضاف في الخطوات الجاية)`);
    return;
  }
  await sendMainMenu(customer.wa_id, "إزاي نقدر نساعدك؟");
}
