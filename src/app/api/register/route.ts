import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/supabase";
import { claimFormToken, peekFormToken, releaseFormToken } from "@/lib/forms/tokens";
import { CoreRegistrationSchema, persistRegistration, registrationSummary } from "@/lib/bot/registration";
import { onRegistered } from "@/lib/bot/quotes";
import { logOutbound, type Conversation, type Customer } from "@/lib/bot/repo";
import { wa } from "@/lib/whatsapp/send";

export const runtime = "nodejs";

const FIELD_ERR: Record<string, string> = {
  full_name: "اكتب الاسم الكامل",
  email: "البريد الإلكتروني غير صحيح",
  customer_type: "اختار نوع العميل",
  company_name: "اسم المنشأة مطلوب للشركات",
  cr_number: "رقم السجل التجاري مطلوب للشركات",
  vat_number: "الرقم الضريبي 15 رقم يبدأ وينتهي بـ 3",
  region: "اختار المنطقة",
  city: "اكتب المدينة",
  district: "اكتب الحي",
  street: "اكتب اسم الشارع",
  building_no: "رقم المبنى لازم 4 أرقام",
  postal_code: "الرمز البريدي لازم 5 أرقام",
  privacy_consent: "لازم توافق على سياسة الخصوصية",
};

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }

  const token = typeof body.token === "string" ? body.token : "";

  // 1. Token still valid? (cheap check before validating)
  if (!(await peekFormToken(token, "register"))) {
    return NextResponse.json({ error: "expired" }, { status: 410 });
  }

  // 2. Validate with the exact same schema as the Flow / chat
  const { token: _t, ...fields } = body;
  const parsed = CoreRegistrationSchema.safeParse(fields);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) {
      const k = String(i.path[0]);
      fieldErrors[k] ??= FIELD_ERR[k] ?? "قيمة غير صحيحة";
    }
    return NextResponse.json({ error: "invalid", fieldErrors }, { status: 422 });
  }

  // 3. Claim the token atomically (prevents double submit)
  const claim = await claimFormToken(token, "register");
  if (!claim) return NextResponse.json({ error: "expired" }, { status: 410 });

  try {
    const cust = await db().from("customers").select("*").eq("id", claim.customer_id).single();
    const conv = await db().from("conversations").select("*").eq("customer_id", claim.customer_id).single();
    if (cust.error || conv.error) throw cust.error ?? conv.error;

    const saved = await persistRegistration(cust.data as Customer, conv.data as Conversation, parsed.data);

    // 4. Confirm on WhatsApp (the customer messaged us minutes ago, so the 24h window is open)
    try {
      const r = await wa.text(saved.wa_id, registrationSummary(saved));
      await logOutbound(conv.data.id, r.messages?.[0]?.id, "text", "[registration_done_web]");
      await onRegistered(saved);
    } catch (err) {
      console.error("[register] saved, but WhatsApp confirmation failed", err);
    }

    return NextResponse.json({ ok: true, code: saved.code, name: saved.full_name });
  } catch (err) {
    console.error("[register] failed to save", err);
    await releaseFormToken(claim.id);
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}
