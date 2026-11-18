import type { Inbound } from "../whatsapp/types";
import { wa } from "../whatsapp/send";
import { getOrCreateConversation, getOrCreateCustomer, logInbound, logOutbound } from "./repo";
import { GROUPS, MENU_IDS, sendGroupMenu, sendMainMenu, type GroupKey } from "./menu";

/**
 * Step 1 handler: identify customer, dedupe, log, and drive the menu.
 * Step 2 adds registration; Step 3 replaces free-text handling with the LLM agent.
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

  // --- Menu navigation by interactive ids ---
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

  // --- Free text (LLM agent comes in Step 3) ---
  const name = customer.full_name ?? msg.profileName ?? "";
  const greeting = isNew
    ? `أهلاً بيك في *هلال الشرق للتجارة* 🌙\nمنصة الخدمات التجارية المتكاملة للاستيراد من الصين.\nرقم العميل الخاص بيك: *${customer.code}*`
    : `أهلاً ${name} 👋\nرقم العميل: *${customer.code}*\nإزاي نقدر نساعدك؟`;
  await sendMainMenu(msg.waId, greeting);
  await logOutbound(conv.id, undefined, "interactive", "[main_menu]");
}
