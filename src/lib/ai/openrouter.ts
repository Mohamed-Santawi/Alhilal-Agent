import { env } from "../env";

/** Minimal OpenAI-compatible chat client for OpenRouter (no SDK needed). */

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type ChatMessage =
  | { role: "system"; content: string | { type: "text"; text: string; cache_control?: { type: "ephemeral" } }[] }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
export type ToolDef = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };

export type ChatResult = { message: Extract<ChatMessage, { role: "assistant" }>; usage?: { prompt_tokens: number; completion_tokens: number } };

export async function chat(messages: ChatMessage[], tools: ToolDef[], opts: { maxTokens?: number; signal?: AbortSignal } = {}): Promise<ChatResult> {
  const e = env();
  if (!e.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not set");

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    signal: opts.signal,
    headers: {
      Authorization: `Bearer ${e.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "X-Title": "Hilal Alsharq WhatsApp Agent",
    },
    body: JSON.stringify({
      model: e.OPENROUTER_MODEL,
      messages,
      tools,
      tool_choice: "auto",
      temperature: 0.3,
      max_tokens: opts.maxTokens ?? 700,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(`OpenRouter ${res.status}: ${JSON.stringify(json.error ?? json).slice(0, 500)}`);
  const msg = json.choices?.[0]?.message;
  if (!msg) throw new Error("OpenRouter: empty response");
  return { message: { role: "assistant", content: msg.content ?? null, tool_calls: msg.tool_calls }, usage: json.usage };
}
