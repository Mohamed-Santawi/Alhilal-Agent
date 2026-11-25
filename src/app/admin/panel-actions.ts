"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/supabase";
import { wa, WaApiError } from "@/lib/whatsapp/send";
import { assertStaff, ALL_ROLES, type StaffRole } from "@/lib/auth/staff";
import { HUMAN_MODE_HOURS } from "@/lib/bot/handoff";
import type { ActionResult } from "./actions";

const now = () => new Date().toISOString();
const done = (msg: string, ...paths: string[]): ActionResult => {
  for (const p of paths.length ? paths : ["/admin"]) revalidatePath(p, "layout");
  return { ok: true, msg };
};
const fail = (msg: string): ActionResult => ({ ok: false, msg });

async function run(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  try { return await fn(); }
  catch (e) { console.error("[panel]", e); return fail(e instanceof Error && e.message.startsWith("غير مصرح") ? e.message : "حدثت مشكلة، يرجى المحاولة مرة أخرى"); }
}
async function audit(actor: string, action: string, entity: string, entityId: string, data?: unknown) {
  await db().from("audit_log").insert({ actor, action, entity, entity_id: entityId, data });
}

async function loadConv(id: string) {
  const r = await db().from("conversations").select("id, mode, state, last_inbound_at, customer_id, customers(wa_id)").eq("id", id).single();
  if (r.error) throw r.error;
  return r.data as unknown as { id: string; mode: string; state: Record<string, unknown>; last_inbound_at: string | null; customer_id: string; customers: { wa_id: string } };
}

/** Staff takes the chat: the bot goes silent for HUMAN_MODE_HOURS (renewed with every staff reply). */
async function setHuman(conv: { id: string; state: Record<string, unknown> }, staffId: string) {
  const state = { ...conv.state, human_until: new Date(Date.now() + HUMAN_MODE_HOURS * 3600_000).toISOString() };
  await db().from("conversations").update({ mode: "human", state, assigned_staff: staffId }).eq("id", conv.id);
}

// ---------------------------------------------------------------- inbox
export async function sendReply(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const me = await assertStaff(ALL_ROLES);
    const text = String(fd.get("text") ?? "").trim().slice(0, 4000);
    if (!text) return fail("اكتب الرسالة أولاً");
    const conv = await loadConv(String(fd.get("conversation_id") ?? ""));

    if (!conv.last_inbound_at || Date.now() - new Date(conv.last_inbound_at).getTime() > 24 * 3600_000) {
      return fail("مرّ أكثر من 24 ساعة على آخر رسالة من العميل، وواتساب لا يسمح بإرسال رسالة حرة. انتظر حتى يراسلكم العميل.");
    }
    let waId: string | undefined;
    try {
      const r = await wa.text(conv.customers.wa_id, text);
      waId = r.messages?.[0]?.id;
    } catch (e) {
      if (e instanceof WaApiError && e.code === 131047) return fail("انتهت نافذة الـ24 ساعة لهذا العميل، ولا يمكن إرسال رسالة حرة.");
      if (e instanceof WaApiError && e.code === 131030) return fail("رقم العميل غير مضاف إلى قائمة الأرقام المسموح بها في الرقم التجريبي.");
      throw e;
    }
    await db().from("messages").insert({ conversation_id: conv.id, wa_message_id: waId, direction: "out", type: "text", body: text, sent_by_staff: me.id });
    await setHuman(conv, me.id);
    await db().from("conversations").update({ staff_seen_at: now() }).eq("id", conv.id);
    return done("تم الإرسال ✓", `/admin/inbox/${conv.id}`);
  });
}

export async function takeOver(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const me = await assertStaff(ALL_ROLES);
    const conv = await loadConv(String(fd.get("conversation_id") ?? ""));
    await setHuman(conv, me.id);
    await audit(me.id, "conversation.taken", "conversations", conv.id);
    return done("أوقفنا الرد الآلي، والمحادثة الآن معك ✓", `/admin/inbox/${conv.id}`);
  });
}

/** Hands the chat back to the bot and closes the open "talk to staff" tasks. */
export async function returnToBot(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const me = await assertStaff(ALL_ROLES);
    const conv = await loadConv(String(fd.get("conversation_id") ?? ""));
    const { human_until: _h, ...state } = conv.state;
    await db().from("conversations").update({ mode: "bot", state, assigned_staff: null }).eq("id", conv.id);
    await db().from("tasks").update({ status: "done", done_at: now(), done_by: me.id })
      .eq("customer_id", conv.customer_id).eq("type", "handoff").in("status", ["open", "in_progress"]);
    await audit(me.id, "conversation.returned", "conversations", conv.id);
    return done("عادت المحادثة إلى الرد الآلي ✓", `/admin/inbox/${conv.id}`);
  });
}

// ---------------------------------------------------------------- tasks
export async function updateTask(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const me = await assertStaff(ALL_ROLES);
    const id = String(fd.get("id") ?? "");
    const op = String(fd.get("op") ?? "");
    const note = String(fd.get("note") ?? "").trim().slice(0, 500) || undefined;
    const patch: Record<string, unknown> =
      op === "take" ? { status: "in_progress", assigned_to: me.id }
      : op === "done" ? { status: "done", done_at: now(), done_by: me.id, ...(note ? { note } : {}) }
      : op === "reopen" ? { status: "open", done_at: null, done_by: null }
      : op === "note" ? { note: note ?? null }
      : {};
    if (!Object.keys(patch).length) return fail("عملية غير معروفة");
    const r = await db().from("tasks").update(patch).eq("id", id);
    if (r.error) throw r.error;
    await audit(me.id, `task.${op}`, "tasks", id, note ? { note } : undefined);
    return done(op === "done" ? "تم إغلاق المهمة ✓" : op === "take" ? "المهمة الآن باسمك ✓" : "تم الحفظ ✓");
  });
}

// ---------------------------------------------------------------- staff (admin only)
const StaffSchema = z.object({
  full_name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(72),
  role: z.enum(["admin", "sales", "china_team", "finance", "legal", "support"]),
  wa_id: z.string().trim().transform((s) => s.replace(/\D/g, "").replace(/^0(5\d{8})$/, "966$1").replace(/^00/, "")).optional(),
});

export async function addStaff(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const me = await assertStaff(["admin"]);
    const p = StaffSchema.safeParse(Object.fromEntries(fd));
    if (!p.success) return fail("يرجى مراجعة البيانات: الاسم، بريد صحيح، وكلمة مرور 8 أحرف على الأقل");
    const { full_name, email, password, role, wa_id } = p.data;

    const exists = await db().from("staff").select("id").eq("email", email).maybeSingle();
    if (exists.data) return fail("هذا البريد مسجّل لموظف آخر");
    const u = await db().auth.admin.createUser({ email, password, email_confirm: true });
    if (u.error || !u.data.user) return fail("تعذّر إنشاء الحساب، ربما البريد مستخدم مسبقاً");

    const r = await db().from("staff").insert({
      auth_user_id: u.data.user.id, email, full_name, role: role as StaffRole, active: true,
      wa_id: wa_id || null, notify: fd.get("notify") === "on" && !!wa_id,
    }).select("id").single();
    if (r.error) { await db().auth.admin.deleteUser(u.data.user.id); throw r.error; }
    await audit(me.id, "staff.added", "staff", r.data.id, { email, role });
    return done(`تمت إضافة ${full_name} ✓`, "/admin/staff");
  });
}

export async function updateStaff(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const me = await assertStaff(["admin"]);
    const id = String(fd.get("id") ?? "");
    const op = String(fd.get("op") ?? "");
    if (id === me.id && op !== "save") return fail("لا يمكنك إيقاف حسابك أنت");
    const row = await db().from("staff").select("auth_user_id, active").eq("id", id).single();
    if (row.error) throw row.error;

    if (op === "toggle") {
      await db().from("staff").update({ active: !row.data.active }).eq("id", id);
      await audit(me.id, row.data.active ? "staff.disabled" : "staff.enabled", "staff", id);
      return done(row.data.active ? "تم إيقاف الحساب ✓" : "تم تفعيل الحساب ✓", "/admin/staff");
    }
    if (op === "password") {
      const pw = String(fd.get("password") ?? "");
      if (pw.length < 8) return fail("كلمة المرور 8 أحرف على الأقل");
      const r = await db().auth.admin.updateUserById(row.data.auth_user_id, { password: pw });
      if (r.error) throw r.error;
      await audit(me.id, "staff.password_reset", "staff", id);
      return done("تم تغيير كلمة المرور ✓", "/admin/staff");
    }
    if (op === "save") {
      const role = String(fd.get("role") ?? "");
      if (!(ALL_ROLES as string[]).includes(role)) return fail("الدور غير صحيح");
      if (id === me.id && role !== "admin") return fail("لا يمكنك إزالة صلاحية المدير عن نفسك");
      const wa_id = String(fd.get("wa_id") ?? "").replace(/\D/g, "").replace(/^0(5\d{8})$/, "966$1").replace(/^00/, "") || null;
      await db().from("staff").update({ role, wa_id, notify: fd.get("notify") === "on" && !!wa_id }).eq("id", id);
      await audit(me.id, "staff.updated", "staff", id, { role, wa_id });
      return done("تم الحفظ ✓", "/admin/staff");
    }
    return fail("عملية غير معروفة");
  });
}
