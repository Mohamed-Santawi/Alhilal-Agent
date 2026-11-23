import { privacyUrl, publicBaseUrl } from "../env";
import { issueFormToken } from "../forms/tokens";
import { wa } from "../whatsapp/send";
import { logOutbound, setState, type Conversation, type Customer } from "./repo";

export const REGISTER_LINK_TTL_MIN = 60;

/** Sends a one-time link to the web registration form. Returns false if the public URL is unknown. */
export async function sendRegistrationLink(customer: Customer, conv: Conversation, intro: string): Promise<boolean> {
  const base = publicBaseUrl();
  if (!base) return false;

  const token = await issueFormToken(customer.id, "register", REGISTER_LINK_TTL_MIN);
  const link = `${base}/register?t=${token}`;
  const privacy = privacyUrl();
  const text = [
    intro,
    ``,
    `📝 افتح نموذج التسجيل من هنا (صالح لمدة ساعة):`,
    link,
    ...(privacy ? [``, `🔒 سياسة الخصوصية:`, privacy] : []),
  ].join("\n");

  // Leaving chat registration (if any) — the web form is now the active path
  const { reg_chat: _c, ...rest } = conv.state;
  conv.state = { ...rest, reg_web_sent_at: new Date().toISOString() };
  await setState(conv.id, conv.state);

  const r = await wa.text(customer.wa_id, text);
  await logOutbound(conv.id, r.messages?.[0]?.id, "text", "[registration_link]");
  return true;
}
