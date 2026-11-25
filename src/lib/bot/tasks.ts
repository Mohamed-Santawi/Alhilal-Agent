import { db } from "../supabase";
import { wa } from "../whatsapp/send";
import { publicBaseUrl } from "../env";

export type TaskType = "handoff" | "shipping_quote" | "fcl_request" | "service_request";

export const TASK_TYPE_AR: Record<string, string> = {
  handoff: "طلب التحدث مع موظف",
  shipping_quote: "طلب شحن",
  fcl_request: "طلب حاوية كاملة",
  service_request: "طلب خدمة",
};

/**
 * Opens a task for the team and alerts staff who turned on notifications.
 * The alert is a free-form WhatsApp message, so it only reaches a staff member who messaged
 * the business number in the last 24 hours (WhatsApp rule); failures are logged, never thrown.
 */
export async function createTask(t: {
  customer_id: string; type: TaskType; title: string; due_hours?: number; quote_id?: string;
}) {
  const r = await db().from("tasks").insert({
    customer_id: t.customer_id,
    type: t.type,
    title: t.title.slice(0, 300),
    quote_id: t.quote_id ?? null,
    due_at: new Date(Date.now() + (t.due_hours ?? 24) * 3600_000).toISOString(),
  }).select("id").single();
  if (r.error) throw r.error;
  const base = publicBaseUrl();
  await notifyStaff(`🔔 ${TASK_TYPE_AR[t.type] ?? "مهمة جديدة"}\n${t.title}${base ? `\n\n${base}/admin/tasks` : ""}`);
  return r.data.id as string;
}

export async function notifyStaff(text: string) {
  try {
    const s = await db().from("staff").select("wa_id").eq("active", true).eq("notify", true).not("wa_id", "is", null);
    await Promise.all((s.data ?? []).map((x) =>
      wa.text(String(x.wa_id), text).catch((err) => console.warn("[notify] staff alert failed", x.wa_id, err?.code ?? err)),
    ));
  } catch (err) {
    console.warn("[notify] failed", err);
  }
}
