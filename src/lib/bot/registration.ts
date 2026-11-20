import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "../env";
import { db } from "../supabase";
import { wa } from "../whatsapp/send";
import {
  audit,
  logOutbound,
  setState,
  type Conversation,
  type Customer,
} from "./repo";

const REGIONS: Record<string, string> = {
  riyadh: "الرياض",
  makkah: "مكة المكرمة",
  madinah: "المدينة المنورة",
  eastern: "المنطقة الشرقية",
  qassim: "القصيم",
  asir: "عسير",
  tabuk: "تبوك",
  hail: "حائل",
  northern_borders: "الحدود الشمالية",
  jazan: "جازان",
  najran: "نجران",
  baha: "الباحة",
  jouf: "الجوف",
};

// Flow returns "" (or the literal "${form.x}" on some clients) for empty optional fields → normalize to undefined
const opt = z.preprocess(
  (v) =>
    typeof v === "string" && v.trim() !== "" && !v.startsWith("${")
      ? v.trim()
      : undefined,
  z.string().optional(),
);
const req = z.string().trim().min(1);
const digits = (n: number) =>
  z.preprocess((v) => String(v ?? "").replace(/\D/g, ""), z.string().length(n));

export const RegistrationSchema = z
  .object({
    flow_token: z.string(),
    full_name: req.max(80),
    email: z.string().trim().toLowerCase().email(),
    alt_phone: opt,
    customer_type: z.enum(["individual", "company"]),
    company_name: opt,
    cr_number: opt,
    region: z.string().refine((r) => r in REGIONS, "invalid region"),
    city: req,
    district: req,
    street: req,
    building_no: digits(4),
    unit_no: opt,
    short_address: opt,
    postal_code: digits(5),
    additional_no: opt,
    recipient_name: opt,
    recipient_phone: opt,
    privacy_consent: z.preprocess(
      (v) => v === true || v === "true",
      z.literal(true),
    ),
  })
  .superRefine((d, ctx) => {
    if (d.customer_type === "company" && !d.company_name)
      ctx.addIssue({
        code: "custom",
        path: ["company_name"],
        message: "اسم المنشأة مطلوب للشركات",
      });
    if (d.customer_type === "company" && !d.cr_number)
      ctx.addIssue({
        code: "custom",
        path: ["cr_number"],
        message: "رقم السجل التجاري مطلوب للشركات",
      });
  });

const FIELD_AR: Record<string, string> = {
  full_name: "الاسم",
  email: "البريد الإلكتروني",
  customer_type: "نوع العميل",
  company_name: "اسم المنشأة",
  cr_number: "رقم السجل التجاري",
  region: "المنطقة",
  city: "المدينة",
  district: "الحي",
  street: "الشارع",
  building_no: "رقم المبنى (4 أرقام)",
  postal_code: "الرمز البريدي (5 أرقام)",
  privacy_consent: "الموافقة على سياسة الخصوصية",
};

/** Sends the registration form. The token ties the submission to this customer. */
export async function sendRegistrationFlow(
  customer: Customer,
  conv: Conversation,
  intro: string,
) {
  const token = `reg:${customer.id}:${randomUUID()}`;
  await setState(conv.id, { ...conv.state, reg_flow_token: token });
  const e = env();
  const r = await wa.flow(customer.wa_id, {
    header: "تسجيل عميل جديد",
    body: e.PRIVACY_POLICY_URL
      ? `${intro}\n\n🔒 سياسة الخصوصية:\n${e.PRIVACY_POLICY_URL}`
      : intro,
    footer: "بياناتك محمية ولن تُشارك إلا لتنفيذ طلباتك",
    cta: "ابدأ التسجيل",
    flowId: e.WHATSAPP_REGISTRATION_FLOW_ID,
    flowToken: token,
    screen: "PERSONAL",
    mode: e.WHATSAPP_FLOW_MODE,
  });
  await logOutbound(
    conv.id,
    r.messages?.[0]?.id,
    "interactive",
    "[registration_flow]",
  );
}

export type RegistrationResult =
  | { ok: true; customer: Customer }
  | { ok: false; reason: "token_mismatch" | "invalid"; missing?: string[] };

export async function saveRegistration(
  customer: Customer,
  conv: Conversation,
  response: Record<string, unknown>,
): Promise<RegistrationResult> {
  // Reject submissions of an old/foreign form
  if (
    !conv.state.reg_flow_token ||
    response.flow_token !== conv.state.reg_flow_token
  ) {
    return { ok: false, reason: "token_mismatch" };
  }

  const parsed = RegistrationSchema.safeParse(response);
  if (!parsed.success) {
    const missing = [
      ...new Set(
        parsed.error.issues.map(
          (i) => FIELD_AR[String(i.path[0])] ?? String(i.path[0]),
        ),
      ),
    ];
    return { ok: false, reason: "invalid", missing };
  }
  const d = parsed.data;

  const upd = await db()
    .from("customers")
    .update({
      full_name: d.full_name,
      email: d.email,
      alt_phone: d.alt_phone ?? null,
      type: d.customer_type,
      company_name: d.customer_type === "company" ? d.company_name : null,
      cr_number: d.customer_type === "company" ? d.cr_number : null,
      privacy_consent_at: new Date().toISOString(),
      registration_complete: true,
    })
    .eq("id", customer.id)
    .select("*")
    .single();
  if (upd.error) throw upd.error;

  // First address becomes default
  const hasDefault = await db()
    .from("addresses")
    .select("id")
    .eq("customer_id", customer.id)
    .eq("is_default", true)
    .limit(1);
  const addr = await db()
    .from("addresses")
    .insert({
      customer_id: customer.id,
      label: "العنوان الرئيسي",
      country: "SA",
      region: REGIONS[d.region],
      city: d.city,
      district: d.district,
      street: d.street,
      building_no: d.building_no,
      unit_no: d.unit_no ?? null,
      short_address: d.short_address?.toUpperCase() ?? null,
      postal_code: d.postal_code,
      additional_no: d.additional_no ?? null,
      recipient_name: d.recipient_name ?? null,
      recipient_phone: d.recipient_phone ?? null,
      is_default: !hasDefault.data?.length,
    });
  if (addr.error) throw addr.error;

  const { reg_flow_token: _drop, ...rest } = conv.state;
  await setState(conv.id, rest);
  await audit("customer", "customer.registered", "customers", customer.id, {
    type: d.customer_type,
  });
  return { ok: true, customer: upd.data };
}

export function registrationSummary(c: Customer & Record<string, unknown>) {
  return [
    `✅ تم تسجيلك بنجاح يا ${c.full_name}`,
    ``,
    `رقم العميل: *${c.code}*`,
    `احتفظ بالرقم ده، هتحتاجه في أي تواصل معانا.`,
    ``,
    `اختار الخدمة اللي محتاجها من القايمة 👇`,
  ].join("\n");
}
