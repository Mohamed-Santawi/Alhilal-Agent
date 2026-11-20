import type { Inbound } from "../whatsapp/types";
import { wa } from "../whatsapp/send";
import { getOrCreateConversation, getOrCreateCustomer, logInbound, logOutbound } from "./repo";
import { GROUPS, MENU_IDS, sendGroupMenu, sendMainMenu, type GroupKey } from "./menu";
import { registrationSummary, saveRegistration, sendRegistrationFlow } from "./registration";

/**
 * Step 2 handler: identify → dedupe → registration gate (WhatsApp Flow) → menu.
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

  // --- 1. Registration form submitted ---
  if (msg.flowResponse && typeof msg.flowResponse.flow_token === "string" && msg.flowResponse.flow_token.startsWith("reg:")) {
    const res = await saveRegistration(customer, conv, msg.flowResponse);
    if (res.ok) {
      await reply(registrationSummary(res.customer));
      await sendMainMenu(msg.waId, "إزاي نقدر نساعدك؟");
      return;
    }
    if (res.reason === "invalid") {
      await reply(`⚠️ في بيانات ناقصة أو غير صحيحة:\n• ${res.missing?.join("\n• ")}\n\nممكن تعبي النموذج مرة ثانية؟`);
    }
    return sendRegistrationFlow(customer, conv, "افتح النموذج وكمّل بياناتك 👇");
  }

  // --- 2. Not registered yet → registration form (human handoff still allowed) ---
  if (!customer.registration_complete) {
    if (msg.replyId === MENU_IDS.human) return reply("تم تحويل طلبك لموظف خدمة العملاء، وهيتواصل معاك قريب.");
    const intro = isNew
      ? "أهلاً بيك في *هلال الشرق للتجارة* 🌙\nمنصة الخدمات التجارية المتكاملة للاستيراد من الصين.\n\nقبل ما نبدأ، محتاجين نسجل بياناتك مرة واحدة بس (أقل من دقيقتين)."
      : "لسه فاضل نكمّل تسجيل بياناتك عشان نقدر نخدمك 👇";
    return sendRegistrationFlow(customer, conv, intro);
  }

  // --- 3. Menu navigation by interactive ids ---
  const id = msg.replyId ?? "";
  if (id.startsWith("grp:")) {
    const g = id.slice(4) as GroupKey;
    if (g in GROUPS) return void (await sendGroupMenu(msg.waId, g));
  }
  if (id.startsWith("svc:")) {
    return reply(`تمام، اخترت: *${msg.text}*\n(تنفيذ الخدمة هيتضاف في الخطوات الجاية)`);
  }
  if (id === MENU_IDS.myOrders) return reply("لسه مفيش طلبات على حسابك.");
  if (id === MENU_IDS.human) return reply("تم تحويل طلبك لموظف خدمة العملاء، وهيتواصل معاك قريب.");

  // --- 4. Free text (LLM agent comes in Step 3) ---
  await sendMainMenu(msg.waId, `أهلاً ${customer.full_name ?? ""} 👋\nرقم العميل: *${customer.code}*\nإزاي نقدر نساعدك؟`);
  await logOutbound(conv.id, undefined, "interactive", "[main_menu]");
}
