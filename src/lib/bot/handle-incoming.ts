import type { Inbound } from "../whatsapp/types";
import { wa } from "../whatsapp/send";
import { getOrCreateConversation, getOrCreateCustomer, logInbound, logOutbound, setState } from "./repo";
import { GROUPS, MENU_IDS, sendGroupMenu, sendMainMenu, type GroupKey } from "./menu";
import { registrationSummary, saveRegistration } from "./registration";
import { handleChatRegistration, startRegistration } from "./registration-chat";
import { onRegistered, proceedWithQuote, QUOTE_IDS, sendQuoteLink } from "./quotes";

/**
 * Quote first, register later:
 * - Anyone can browse the menu and use the shipping price calculator.
 * - Registration is asked only when the customer proceeds with a quote or starts a service.
 * Step 3 replaces free-text handling with the LLM agent.
 */
export async function handleIncoming(msg: Inbound) {
  const { customer, isNew } = await getOrCreateCustomer(msg.waId);
  const conv = await getOrCreateConversation(customer.id);

  const firstTime = await logInbound(conv.id, msg);
  if (!firstTime) return; // WhatsApp retry — already handled

  wa.markRead(msg.waMessageId).catch(() => {});

  if (conv.mode === "human") return; // a staff member owns this chat; bot stays silent

  const reply = async (text: string) => {
    const r = await wa.text(msg.waId, text);
    await logOutbound(conv.id, r.messages?.[0]?.id, "text", text);
  };
  const id = msg.replyId ?? "";

  // --- 1. Registration Flow submitted ---
  if (msg.flowResponse && typeof msg.flowResponse.flow_token === "string" && msg.flowResponse.flow_token.startsWith("reg:")) {
    const res = await saveRegistration(customer, conv, msg.flowResponse);
    if (res.ok) {
      await reply(registrationSummary(res.customer));
      return onRegistered(res.customer);
    }
    if (res.reason === "invalid") {
      await reply(`⚠️ في بيانات ناقصة أو غير صحيحة:\n• ${res.missing?.join("\n• ")}\n\nممكن تعبي النموذج مرة ثانية؟`);
    }
    return startRegistration(customer, conv, "افتح النموذج وكمّل بياناتك 👇");
  }

  // --- 2. Chat registration in progress → it owns the conversation until done or cancelled ---
  if (!customer.registration_complete && (await handleChatRegistration(customer, conv, msg))) return;

  // --- 3. Shipping price calculator (no registration needed) ---
  if (id === MENU_IDS.quote || id === QUOTE_IDS.again) return sendQuoteLink(customer, conv);
  if (id.startsWith("quote:go:")) return proceedWithQuote(customer, conv, id.slice("quote:go:".length), startRegistration);

  // --- 4. Menu navigation ---
  if (id.startsWith("grp:")) {
    const g = id.slice(4) as GroupKey;
    if (g in GROUPS) return void (await sendGroupMenu(msg.waId, g));
  }
  if (id.startsWith("svc:")) {
    const key = id.slice(4);
    if (key === "shipping_lcl") return sendQuoteLink(customer, conv); // LCL / air → calculator first
    if (!customer.registration_complete) {
      conv.state = { ...conv.state, pending_service: { key, name: msg.text ?? key } };
      await setState(conv.id, conv.state);
      return startRegistration(customer, conv, `عشان نبدأ طلب *${msg.text ?? "الخدمة"}*، محتاجين نسجل بياناتك مرة واحدة بس.`);
    }
    return reply(`تمام، اخترت: *${msg.text}*\n(تنفيذ الخدمة هيتضاف في الخطوات الجاية)`);
  }
  if (id === MENU_IDS.myOrders) {
    return reply(customer.registration_complete ? "لسه مفيش طلبات على حسابك." : "لسه مفيش طلبات. ابدأ بحاسبة أسعار الشحن من القايمة 👇");
  }
  if (id === MENU_IDS.human) return reply("تم تحويل طلبك لموظف خدمة العملاء، وهيتواصل معاك قريب.");

  // --- 5. Free text (LLM agent comes in Step 3) ---
  const greeting = isNew
    ? "أهلاً بيك في *هلال الشرق للتجارة* 🌙\nمنصة الخدمات التجارية المتكاملة للاستيراد من الصين.\n\nتقدر تحسب سعر شحنتك فوراً، أو تختار الخدمة اللي محتاجها 👇"
    : customer.registration_complete
      ? `أهلاً ${customer.full_name ?? ""} 👋\nرقم العميل: *${customer.code}*\nإزاي نقدر نساعدك؟`
      : "أهلاً بيك 👋 إزاي نقدر نساعدك؟";
  await sendMainMenu(msg.waId, greeting);
  await logOutbound(conv.id, undefined, "interactive", "[main_menu]");
}
