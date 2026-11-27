import type { Inbound } from "../whatsapp/types";
import { wa } from "../whatsapp/send";
import { getOrCreateConversation, getOrCreateCustomer, logInbound, logOutbound, setState } from "./repo";
import { GROUPS, MENU_IDS, sendGroupMenu, sendMainMenu, type GroupKey } from "./menu";
import { registrationSummary, saveRegistration } from "./registration";
import { handleChatRegistration, startRegistration } from "./registration-chat";
import { onRegistered, proceedWithQuote, QUOTE_IDS, requestService, sendMyOrders, sendQuoteLink } from "./quotes";
import { handoffToHuman, isHumanMode } from "./handoff";
import { agentEnabled, runAgent } from "../ai/agent";

/**
 * Quote first, register later:
 * - Anyone can browse the menu and use the shipping price calculator.
 * - Registration is asked only when the customer proceeds with a quote or starts a service.
 * - Free text goes to the AI agent (if OPENROUTER_API_KEY is set), otherwise the menu.
 */
export async function handleIncoming(msg: Inbound) {
  const { customer, isNew } = await getOrCreateCustomer(msg.waId);
  const conv = await getOrCreateConversation(customer.id);

  const firstTime = await logInbound(conv.id, msg);
  if (!firstTime) return; // WhatsApp retry — already handled

  wa.markRead(msg.waMessageId).catch(() => {});

  if (await isHumanMode(conv)) return; // a staff member owns this chat; bot stays silent until it expires

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
      await reply(`⚠️ توجد بيانات ناقصة أو غير صحيحة:\n• ${res.missing?.join("\n• ")}\n\nنرجو تعبئة النموذج مرة أخرى.`);
    }
    return startRegistration(customer, conv, "يرجى فتح النموذج وإكمال بياناتك 👇");
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
    if (key === "shipping_lcl" || key === "shipping_fcl") return sendQuoteLink(customer, conv); // shipping → calculator first
    if (!customer.registration_complete) {
      conv.state = { ...conv.state, pending_service: { key, name: msg.text ?? key } };
      await setState(conv.id, conv.state);
      return startRegistration(customer, conv, `لبدء طلب *${msg.text ?? "الخدمة"}*، نحتاج إلى تسجيل بياناتك مرة واحدة فقط.`);
    }
    return requestService(customer, conv, key, msg.text ?? key);
  }
  if (id === MENU_IDS.myOrders) return sendMyOrders(customer, conv);
  if (id === MENU_IDS.human) return handoffToHuman(customer, conv, "طلب التحدث مع موظف من القائمة");

  // --- 5. Free text → AI agent ---
  const text = (msg.text ?? "").trim();
  const justGreeting = /^(ال)?سلام|^مرحب|^هلا|^اهلا|^أهلا|^hi\b|^hello\b|^hey\b/i.test(text) && text.length < 30;

  if (isNew) {
    // First contact: deterministic welcome + menu, then answer the question if there was one.
    await sendMainMenu(msg.waId, "أهلاً بك في *هلال الشرق للتجارة* 🌙\nمنصة الخدمات التجارية المتكاملة للاستيراد من الصين.\n\nيمكنك حساب سعر شحنتك فوراً، أو اختيار الخدمة التي تحتاجها، أو كتابة سؤالك 👇");
    await logOutbound(conv.id, undefined, "interactive", "[رسالة ترحيب + القائمة]");
    if (agentEnabled() && text && !justGreeting) await runAgent(customer, conv, msg.waMessageId);
    return;
  }
  if (agentEnabled()) return runAgent(customer, conv, msg.waMessageId);

  await sendMainMenu(msg.waId, customer.registration_complete
    ? `أهلاً ${customer.full_name ?? ""} 👋\nرقم العميل: *${customer.code}*\nكيف يمكننا مساعدتك؟`
    : "أهلاً بك 👋 كيف يمكننا مساعدتك؟");
  await logOutbound(conv.id, undefined, "interactive", "[القائمة الرئيسية]");
}
