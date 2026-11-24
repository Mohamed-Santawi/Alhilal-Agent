import { env, privacyUrl } from "../env";
import { wa, WaApiError } from "../whatsapp/send";
import type { Inbound } from "../whatsapp/types";
import { logOutbound, setState, type Conversation, type Customer } from "./repo";
import { CoreRegistrationSchema, persistRegistration, sendRegistrationFlow, registrationSummary, type RegistrationData } from "./registration";
import { onRegistered } from "./quotes";
import { sendRegistrationLink } from "./registration-web";

/**
 * Conversational registration — asks one question at a time.
 * Used when WhatsApp Flows are unavailable (e.g. Meta "Blocked by Integrity" on unverified accounts)
 * or when REGISTRATION_MODE=chat.
 */

type Data = Partial<Record<keyof RegistrationData | "recipient_choice", string>>;
type ChatState = { step: string; data: Data };
type Parsed = { value: string } | { error: string };
type Step = {
  key: keyof Data;
  ask: (d: Data) => string;
  buttons?: { id: string; title: string }[];
  when?: (d: Data) => boolean;
  parse: (text: string, replyId?: string) => Parsed;
};

const SKIP = { id: "reg:skip", title: "تخطي" };
const onlyDigits = (t: string) => t.replace(/[٠-٩]/g, (c) => String("٠١٢٣٤٥٦٧٨٩".indexOf(c))).replace(/\D/g, "");
const required = (min = 2, max = 80) => (t: string): Parsed =>
  t.trim().length >= min && t.trim().length <= max ? { value: t.trim() } : { error: "من فضلك اكتب قيمة صحيحة." };
const exactDigits = (n: number, label: string) => (t: string): Parsed => {
  const d = onlyDigits(t);
  return d.length === n ? { value: d } : { error: `${label} يجب أن يتكون من ${n} أرقام.` };
};

const STEPS: Step[] = [
  { key: "full_name", ask: () => "ما اسمك الكامل؟", parse: required(3) },
  {
    key: "email", ask: () => "ما بريدك الإلكتروني؟",
    parse: (t) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t.trim()) ? { value: t.trim().toLowerCase() } : { error: "البريد الإلكتروني غير صحيح، مثال: name@gmail.com" }),
  },
  {
    key: "customer_type", ask: () => "هل التسجيل لفرد أم لشركة / مؤسسة؟",
    buttons: [{ id: "reg:individual", title: "فرد" }, { id: "reg:company", title: "شركة / مؤسسة" }],
    parse: (t, id) => {
      if (id === "reg:individual" || /فرد/.test(t)) return { value: "individual" };
      if (id === "reg:company" || /شرك|مؤسس/.test(t)) return { value: "company" };
      return { error: "يرجى الاختيار من الأزرار: فرد أو شركة." };
    },
  },
  { key: "company_name", when: (d) => d.customer_type === "company", ask: () => "ما اسم المنشأة؟", parse: required(2, 120) },
  {
    key: "cr_number", when: (d) => d.customer_type === "company", ask: () => "ما رقم السجل التجاري (أو الرقم الموحد)؟",
    parse: (t) => { const d = onlyDigits(t); return d.length >= 7 && d.length <= 10 ? { value: d } : { error: "رقم السجل يجب أن يكون من 7 إلى 10 أرقام." }; },
  },
  {
    key: "vat_number", when: (d) => d.customer_type === "company", buttons: [SKIP],
    ask: () => "ما رقم شهادة التسجيل في ضريبة القيمة المضافة؟ (15 رقماً)\nإذا لم تكن مسجّلاً اضغط «تخطي».",
    parse: (t, id) => {
      if (id === SKIP.id || /تخطي/.test(t)) return { value: "" };
      const d = onlyDigits(t);
      return /^3\d{13}3$/.test(d) ? { value: d } : { error: "الرقم الضريبي مكوّن من 15 رقماً ويبدأ وينتهي بالرقم 3. أو اضغط تخطي." };
    },
  },
  { key: "region", ask: () => "📍 *العنوان الوطني*\nفي أي منطقة؟ (مثال: الرياض، مكة المكرمة، المنطقة الشرقية)", parse: required(3, 40) },
  { key: "city", ask: () => "ما المدينة؟", parse: required(2, 40) },
  { key: "district", ask: () => "ما اسم الحي؟", parse: required(2, 60) },
  { key: "street", ask: () => "ما اسم الشارع؟", parse: required(2, 80) },
  { key: "building_no", ask: () => "ما رقم المبنى؟ (4 أرقام)", parse: exactDigits(4, "رقم المبنى") },
  { key: "postal_code", ask: () => "ما الرمز البريدي؟ (5 أرقام)", parse: exactDigits(5, "الرمز البريدي") },
  {
    key: "short_address", ask: () => "ما العنوان المختصر؟ (مثال: RRRD2929)\nإذا لم تكن تعرفه اضغط «تخطي».", buttons: [SKIP],
    parse: (t, id) => {
      if (id === SKIP.id || /تخطي/.test(t)) return { value: "" };
      const v = t.replace(/\s/g, "").toUpperCase();
      return /^[A-Z]{4}\d{4}$/.test(v) ? { value: v } : { error: "العنوان المختصر يتكون من 4 أحرف إنجليزية و4 أرقام، مثال: RRRD2929، أو اضغط «تخطي»." };
    },
  },
  {
    key: "recipient_choice", ask: () => "من سيستلم الشحنات على هذا العنوان؟",
    buttons: [{ id: "reg:self", title: "أنا المستلم" }, { id: "reg:other", title: "شخص آخر" }],
    parse: (t, id) => {
      if (id === "reg:self" || /أنا|انا/.test(t)) return { value: "self" };
      if (id === "reg:other" || /آخر|اخر|غير/.test(t)) return { value: "other" };
      return { error: "يرجى الاختيار من الأزرار." };
    },
  },
  { key: "recipient_name", when: (d) => d.recipient_choice === "other", ask: () => "ما اسم المستلم؟", parse: required(3) },
  {
    key: "recipient_phone", when: (d) => d.recipient_choice === "other", ask: () => "ما رقم جوال المستلم؟",
    parse: (t) => { const d = onlyDigits(t); return d.length >= 9 && d.length <= 15 ? { value: d } : { error: "رقم الجوال غير صحيح." }; },
  },
  {
    key: "privacy_consent",
    ask: () => {
      const url = privacyUrl();
      return `آخر خطوة ✅\nهل توافق على سياسة الخصوصية وجمع بياناتك لتقديم الخدمة؟${url ? `\n\n🔒 ${url}` : ""}`;
    },
    buttons: [{ id: "reg:agree", title: "أوافق" }],
    parse: (t, id) => (id === "reg:agree" || /أوافق|اوافق|موافق/.test(t) ? { value: "true" } : { error: "يجب الموافقة على سياسة الخصوصية لإكمال التسجيل." }),
  },
];

const nextStep = (from: number, d: Data) => STEPS.findIndex((s, i) => i >= from && (!s.when || s.when(d)));

async function ask(customer: Customer, conv: Conversation, step: Step, d: Data, prefix?: string) {
  const text = prefix ? `${prefix}\n\n${step.ask(d)}` : step.ask(d);
  const r = step.buttons ? await wa.buttons(customer.wa_id, text, step.buttons) : await wa.text(customer.wa_id, text);
  await logOutbound(conv.id, r.messages?.[0]?.id, step.buttons ? "interactive" : "text", text);
}

export async function startChatRegistration(customer: Customer, conv: Conversation, intro: string) {
  const state: ChatState = { step: STEPS[0].key, data: {} };
  conv.state = { ...conv.state, reg_chat: state };
  await setState(conv.id, conv.state);
  await ask(customer, conv, STEPS[0], {}, `${intro}\n\n(يمكنك كتابة *إلغاء* في أي وقت للبدء من جديد)`);
}

/**
 * Entry point for unregistered customers.
 * auto: WhatsApp Flow → web form link → chat. Each step falls back to the next if unavailable.
 */
export async function startRegistration(customer: Customer, conv: Conversation, intro: string) {
  const mode = env().REGISTRATION_MODE;

  if ((mode === "auto" || mode === "flow") && env().WHATSAPP_REGISTRATION_FLOW_ID) {
    try {
      return await sendRegistrationFlow(customer, conv, intro);
    } catch (err) {
      if (mode === "flow") throw err;
      console.warn("[registration] Flow unavailable, trying web form:", err instanceof WaApiError ? err.code : String(err));
    }
  }

  if (mode === "auto" || mode === "web") {
    try {
      if (await sendRegistrationLink(customer, conv, intro)) return;
      console.warn("[registration] PUBLIC_BASE_URL unknown, falling back to chat");
    } catch (err) {
      if (mode === "web") throw err;
      console.warn("[registration] web form unavailable, falling back to chat:", String(err));
    }
  }

  return startChatRegistration(customer, conv, intro);
}

/** Returns true if the message was consumed by the chat registration. */
export async function handleChatRegistration(customer: Customer, conv: Conversation, msg: Inbound): Promise<boolean> {
  const state = conv.state.reg_chat as ChatState | undefined;
  if (!state) return false;

  const text = (msg.text ?? "").trim();
  if (/^(إلغاء|الغاء|ابدأ من جديد)$/.test(text)) {
    await startChatRegistration(customer, conv, "حسناً، نبدأ التسجيل من جديد 👇");
    return true;
  }

  const idx = STEPS.findIndex((s) => s.key === state.step);
  const step = STEPS[idx];
  if (!step) { await startChatRegistration(customer, conv, "نبدأ التسجيل 👇"); return true; }

  const res = step.parse(text, msg.replyId);
  if ("error" in res) { await ask(customer, conv, step, state.data, `⚠️ ${res.error}`); return true; }

  const data: Data = { ...state.data, [step.key]: res.value };
  const next = nextStep(idx + 1, data);

  if (next !== -1) {
    conv.state = { ...conv.state, reg_chat: { step: STEPS[next].key, data } };
    await setState(conv.id, conv.state);
    await ask(customer, conv, STEPS[next], data);
    return true;
  }

  // All steps done → validate with the same schema as the Flow and save
  const { recipient_choice: _r, ...fields } = data;
  const parsed = CoreRegistrationSchema.safeParse({ ...fields, privacy_consent: true });
  if (!parsed.success) {
    console.error("[registration-chat] validation failed", parsed.error.issues);
    await startChatRegistration(customer, conv, "⚠️ حدثت مشكلة في البيانات، سنعيد التسجيل.");
    return true;
  }
  const saved = await persistRegistration(customer, conv, parsed.data);
  const r = await wa.text(customer.wa_id, registrationSummary(saved));
  await logOutbound(conv.id, r.messages?.[0]?.id, "text", "[registration_done]");
  await onRegistered(saved);
  return true;
}
