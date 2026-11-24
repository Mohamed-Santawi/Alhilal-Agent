import { env } from "../env";

type ListRow = { id: string; title: string; description?: string };   // title ≤ 24 chars, desc ≤ 72
type ListSection = { title: string; rows: ListRow[] };                // max 10 rows TOTAL across sections
type Button = { id: string; title: string };                          // max 3 buttons, title ≤ 20 chars

/** Carries Meta's numeric error code (e.g. 131030 not in allowed list, 139000 blocked by integrity). */
export class WaApiError extends Error {
  constructor(public status: number, public code: number | undefined, public body: unknown) {
    super(`WhatsApp API ${status}: ${JSON.stringify(body)}`);
  }
}

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
  if (!res.ok) throw new WaApiError(res.status, json?.error?.code, json);
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

  /** Opens a WhatsApp Flow (form inside WhatsApp). The submission comes back as interactive.nfm_reply. */
  flow: (to: string, opts: {
    body: string; cta: string; flowId: string; flowToken: string; screen: string;
    header?: string; footer?: string; data?: Record<string, unknown>; mode?: "draft" | "published";
  }) =>
    callApi({
      to,
      type: "interactive",
      interactive: {
        type: "flow",
        ...(opts.header ? { header: { type: "text", text: opts.header } } : {}),
        body: { text: opts.body },
        ...(opts.footer ? { footer: { text: opts.footer } } : {}),
        action: {
          name: "flow",
          parameters: {
            flow_message_version: "3",
            flow_token: opts.flowToken,
            flow_id: opts.flowId,
            flow_cta: opts.cta.slice(0, 20),
            flow_action: "navigate",
            flow_action_payload: { screen: opts.screen, ...(opts.data ? { data: opts.data } : {}) },
            ...(opts.mode === "draft" ? { mode: "draft" } : {}),
          },
        },
      },
    }),

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

  /** Marks as read AND shows "typing…" to the customer (up to ~25s or until we reply). */
  typing: (messageId: string) => callApi({ status: "read", message_id: messageId, typing_indicator: { type: "text" } }),
};
