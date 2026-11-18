// Minimal typing of the WhatsApp Cloud API webhook payload (only what we use).

export type WaMedia = { id: string; mime_type?: string; caption?: string; filename?: string };

export type WaInboundMessage = {
  id: string;
  from: string; // wa_id (international number without +)
  timestamp: string;
  type: "text" | "interactive" | "image" | "document" | "video" | "audio" | "button" | "location" | string;
  text?: { body: string };
  interactive?: {
    type: "list_reply" | "button_reply" | "nfm_reply";
    list_reply?: { id: string; title: string };
    button_reply?: { id: string; title: string };
    nfm_reply?: { response_json: string; name?: string }; // WhatsApp Flows submission
  };
  button?: { payload: string; text: string }; // template quick-reply
  image?: WaMedia;
  document?: WaMedia;
  video?: WaMedia;
  audio?: WaMedia;
};

export type WaWebhookBody = {
  object: string;
  entry?: Array<{
    changes?: Array<{
      field: string;
      value: {
        messaging_product: "whatsapp";
        metadata: { phone_number_id: string };
        contacts?: Array<{ wa_id: string; profile?: { name?: string } }>;
        messages?: WaInboundMessage[];
        statuses?: Array<{ id: string; status: string; recipient_id: string }>;
      };
    }>;
  }>;
};

/** Normalized inbound message the rest of the app works with. */
export type Inbound = {
  waMessageId: string;
  waId: string;
  profileName?: string;
  type: WaInboundMessage["type"];
  text?: string;       // text body, or the title of the chosen list/button
  replyId?: string;    // id of the chosen list row / button
  flowResponse?: Record<string, unknown>;
  media?: WaMedia & { kind: "image" | "document" | "video" | "audio" };
  raw: WaInboundMessage;
};

export function extractInbound(body: WaWebhookBody): Inbound[] {
  const out: Inbound[] = [];
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value;
      if (!v?.messages) continue; // status updates (sent/delivered/read) are ignored for now
      const names = new Map(v.contacts?.map((c) => [c.wa_id, c.profile?.name]) ?? []);
      for (const m of v.messages) {
        const i = m.interactive;
        const reply = i?.list_reply ?? i?.button_reply;
        const mediaKind = (["image", "document", "video", "audio"] as const).find((k) => m[k]);
        let flowResponse: Record<string, unknown> | undefined;
        if (i?.nfm_reply?.response_json) {
          try { flowResponse = JSON.parse(i.nfm_reply.response_json); } catch { /* ignore */ }
        }
        out.push({
          waMessageId: m.id,
          waId: m.from,
          profileName: names.get(m.from),
          type: m.type,
          text: m.text?.body ?? reply?.title ?? m.button?.text ?? m[mediaKind ?? "image"]?.caption,
          replyId: reply?.id ?? m.button?.payload,
          flowResponse,
          media: mediaKind ? { ...m[mediaKind]!, kind: mediaKind } : undefined,
          raw: m,
        });
      }
    }
  }
  return out;
}
