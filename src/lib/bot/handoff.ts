import { db } from "../supabase";
import { wa } from "../whatsapp/send";
import { audit, logOutbound, type Conversation, type Customer } from "./repo";

export const HUMAN_MODE_HOURS = 24;

/**
 * Hands the chat to a human: the bot stops replying for HUMAN_MODE_HOURS (or until staff hands it back),
 * and a task is created for the team.
 */
export async function handoffToHuman(customer: Customer, conv: Conversation, reason: string) {
  const until = new Date(Date.now() + HUMAN_MODE_HOURS * 3600_000).toISOString();
  conv.state = { ...conv.state, human_until: until };
  await db().from("conversations").update({ mode: "human", state: conv.state }).eq("id", conv.id);

  // One open handoff task per customer is enough
  const open = await db().from("tasks").select("id").eq("customer_id", customer.id).eq("type", "handoff").in("status", ["open", "in_progress"]).limit(1);
  if (!open.data?.length) {
    await db().from("tasks").insert({
      customer_id: customer.id, type: "handoff",
      title: `تواصل مع ${customer.full_name ?? customer.code} (${customer.wa_id}) — ${reason}`.slice(0, 300),
      due_at: new Date(Date.now() + 2 * 3600_000).toISOString(),
    });
  }
  await audit("bot", "conversation.handoff", "conversations", conv.id, { reason });

  const text = "تم تحويل محادثتك إلى أحد موظفي خدمة العملاء 👤\nسيتواصل معك في أقرب وقت خلال أوقات العمل.";
  const r = await wa.text(customer.wa_id, text);
  await logOutbound(conv.id, r.messages?.[0]?.id, "text", text);
}

/** True if the conversation is with a human right now. Expired human mode switches back to the bot. */
export async function isHumanMode(conv: Conversation): Promise<boolean> {
  if (conv.mode !== "human") return false;
  const until = typeof conv.state.human_until === "string" ? new Date(conv.state.human_until) : null;
  if (until && until < new Date()) {
    const { human_until: _h, ...rest } = conv.state;
    conv.state = rest;
    conv.mode = "bot";
    await db().from("conversations").update({ mode: "bot", state: rest }).eq("id", conv.id);
    return false;
  }
  return true;
}
