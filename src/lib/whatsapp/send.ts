import { env } from "../env";

type ListRow = { id: string; title: string; description?: string };   // title ≤ 24 chars, desc ≤ 72
type ListSection = { title: string; rows: ListRow[] };                // max 10 rows TOTAL across sections
type Button = { id: string; title: string };                          // max 3 buttons, title ≤ 20 chars

async function callApi(payload: Record<string, unknown>) {
  const e = env();
  const res = await fetch(
    `https://graph.facebook.com/${e.WHATSAPP_API_VERSION}/${e.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${e.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
    },
  );
  const json = await res.json();
  if (!res.ok) throw new Error(`WhatsApp API ${res.status}: ${JSON.stringify(json)}`);
  return json as { messages: Array<{ id: string }> };
}

export const wa = {
  text: (to: string, body: string) =>
    callApi({ to, type: "text", text: { body, preview_url: true } }),

  buttons: (to: string, body: string, buttons: Button[]) => {
    if (buttons.length > 3) throw new Error("WhatsApp allows max 3 reply buttons");
    return callApi({
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: body },
        action: { buttons: buttons.map((b) => ({ type: "reply", reply: { id: b.id, title: b.title.slice(0, 20) } })) },
      },
    });
  },

  list: (to: string, body: string, buttonLabel: string, sections: ListSection[]) => {
    const rows = sections.reduce((n, s) => n + s.rows.length, 0);
    if (rows > 10) throw new Error(`WhatsApp list allows max 10 rows, got ${rows}`);
    return callApi({
      to,
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: body },
        action: {
          button: buttonLabel.slice(0, 20),
          sections: sections.map((s) => ({
            title: s.title.slice(0, 24),
            rows: s.rows.map((r) => ({ id: r.id, title: r.title.slice(0, 24), description: r.description?.slice(0, 72) })),
          })),
        },
      },
    });
  },

  /** Template message — required to message a customer outside the 24h window. */
  template: (to: string, name: string, lang = "ar", bodyParams: string[] = []) =>
    callApi({
      to,
      type: "template",
      template: {
        name,
        language: { code: lang },
        components: bodyParams.length
          ? [{ type: "body", parameters: bodyParams.map((t) => ({ type: "text", text: t })) }]
          : [],
      },
    }),

  markRead: (messageId: string) => callApi({ status: "read", message_id: messageId }),
};
