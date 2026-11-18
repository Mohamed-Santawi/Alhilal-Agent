import { db } from "../supabase";

export type Customer = {
  id: string; code: string; wa_id: string; full_name: string | null;
  registration_complete: boolean;
};
export type Conversation = {
  id: string; customer_id: string; mode: "bot" | "human"; state: Record<string, unknown>;
};

/**
 * Select first, insert only if missing.
 * (An upsert would burn a value of customer_code_seq on every message → gaps in HA-xxxxxx.)
 */
export async function getOrCreateCustomer(waId: string): Promise<{ customer: Customer; isNew: boolean }> {
  const found = await db().from("customers").select("*").eq("wa_id", waId).maybeSingle();
  if (found.error) throw found.error;
  if (found.data) return { customer: found.data, isNew: false };

  const ins = await db().from("customers").insert({ wa_id: waId }).select("*").single();
  if (ins.error) {
    if (ins.error.code === "23505") { // race: another request created it
      const again = await db().from("customers").select("*").eq("wa_id", waId).single();
      if (again.error) throw again.error;
      return { customer: again.data, isNew: false };
    }
    throw ins.error;
  }
  await audit("bot", "customer.created", "customers", ins.data.id, { code: ins.data.code });
  return { customer: ins.data, isNew: true };
}

export async function getOrCreateConversation(customerId: string): Promise<Conversation> {
  const r = await db()
    .from("conversations")
    .upsert({ customer_id: customerId, last_inbound_at: new Date().toISOString() }, { onConflict: "customer_id" })
    .select("*")
    .single();
  if (r.error) throw r.error;
  return r.data;
}

/** Returns false if this WhatsApp message id was already processed (webhook retry). */
export async function logInbound(conversationId: string, m: {
  waMessageId: string; type: string; text?: string; raw: unknown;
}): Promise<boolean> {
  const r = await db()
    .from("messages")
    .upsert(
      { conversation_id: conversationId, wa_message_id: m.waMessageId, direction: "in", type: m.type, body: m.text, payload: m.raw },
      { onConflict: "wa_message_id", ignoreDuplicates: true },
    )
    .select("id");
  if (r.error) throw r.error;
  return (r.data?.length ?? 0) > 0;
}

export async function logOutbound(conversationId: string, waMessageId: string | undefined, type: string, body: string) {
  await db().from("messages").insert({ conversation_id: conversationId, wa_message_id: waMessageId, direction: "out", type, body });
}

export async function setState(conversationId: string, state: Record<string, unknown>) {
  const r = await db().from("conversations").update({ state }).eq("id", conversationId);
  if (r.error) throw r.error;
}

export async function audit(actor: string, action: string, entity: string, entityId?: string, data?: unknown) {
  await db().from("audit_log").insert({ actor, action, entity, entity_id: entityId, data });
}
