import { db } from "../supabase";
import { env } from "../env";
import { wa } from "../whatsapp/send";
import { logOutbound, type Conversation, type Customer } from "../bot/repo";
import { sendMainMenu } from "../bot/menu";
import { chat, type ChatMessage } from "./openrouter";
import { contextNote, SYSTEM_PROMPT } from "./prompt";
import { runTool, TOOL_DEFS, type ToolCtx } from "./tools";

const HISTORY = 20;       // messages of context
const MAX_ROUNDS = 5;     // tool-call rounds per reply
const TIMEOUT_MS = 45_000;

export const agentEnabled = () => Boolean(env().OPENROUTER_API_KEY);

/** Turns the stored WhatsApp history into chat turns (alternating user / assistant). */
export async function loadHistory(convId: string): Promise<ChatMessage[]> {
  const r = await db().from("messages").select("direction, type, body").eq("conversation_id", convId)
    .order("created_at", { ascending: false }).limit(HISTORY);
  const rows = [...(r.data ?? [])].reverse(); // oldest → newest
  const turns: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of rows) {
    const role = m.direction === "in" ? "user" : "assistant";
    const text = (m.body ?? "").trim() || (m.type === "image" ? "[صورة]" : m.type === "document" ? "[ملف]" : m.type === "audio" ? "[رسالة صوتية]" : `[${m.type}]`);
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.content += `\n${text.slice(0, 1500)}`;
    else turns.push({ role, content: text.slice(0, 1500) });
  }
  while (turns.length && turns[0].role === "assistant") turns.shift(); // must start with the customer
  // Must END with the customer too (e.g. a welcome menu was sent right before the agent runs):
  // fold trailing bot messages into the context instead of leaving the assistant "mid-sentence".
  const tail: string[] = [];
  while (turns.length && turns[turns.length - 1].role === "assistant") tail.unshift(turns.pop()!.content);
  if (tail.length && turns.length) turns[turns.length - 1].content += `\n\n(ملاحظة للنظام: تم إرسال هذا للعميل للتو: ${tail.join(" / ")})`;
  return turns;
}

async function sendText(customer: Customer, conv: Conversation, text: string) {
  for (let i = 0; i < text.length; i += 3800) {
    const part = text.slice(i, i + 3800);
    const r = await wa.text(customer.wa_id, part);
    await logOutbound(conv.id, r.messages?.[0]?.id, "text", part);
  }
}

/** Answers a free-text message with the LLM + tools. Never throws: falls back to the menu. */
export async function runAgent(customer: Customer, conv: Conversation, waMessageId?: string): Promise<void> {
  if (waMessageId) wa.typing(waMessageId).catch(() => {});
  const ctx: ToolCtx = { customer, conv, sent: false, stop: false };
  const abort = AbortSignal.timeout(TIMEOUT_MS);

  try {
    const messages: ChatMessage[] = [
      { role: "system", content: [
        { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
        { type: "text", text: contextNote(customer) },
      ] },
      ...(await loadHistory(conv.id)),
    ];

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const { message, usage } = await chat(messages, TOOL_DEFS, { signal: abort });
      if (usage) console.log(`[agent] tokens in=${usage.prompt_tokens} out=${usage.completion_tokens}`);

      if (!message.tool_calls?.length) {
        const text = (message.content ?? "").trim();
        if (text) await sendText(customer, conv, text);
        else if (!ctx.sent) await sendMainMenu(customer.wa_id, "كيف يمكننا مساعدتك؟");
        return;
      }

      messages.push({ role: "assistant", content: message.content ?? null, tool_calls: message.tool_calls });
      for (const call of message.tool_calls) {
        let result: unknown;
        try { result = await runTool(call.function.name, call.function.arguments, ctx); }
        catch (err) { console.error("[agent] tool failed", call.function.name, err); result = { error: "tool failed" }; }
        console.log(`[agent] tool ${call.function.name}`);
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result).slice(0, 8000) });
      }
      if (ctx.stop) return; // registration / handoff took over the conversation
    }
    if (!ctx.sent) await sendMainMenu(customer.wa_id, "كيف يمكننا مساعدتك؟");
  } catch (err) {
    console.error("[agent] failed", err);
    if (!ctx.sent) {
      await sendMainMenu(customer.wa_id, "أهلاً بك 👋 يمكنك الاختيار من القائمة، أو كتابة سؤالك مرة أخرى.").catch(() => {});
    }
  }
}
