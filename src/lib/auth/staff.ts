import { redirect } from "next/navigation";
import { db } from "../supabase";
import { authClient } from "./supabase-server";

export type StaffRole = "admin" | "sales" | "china_team" | "finance" | "legal" | "support";
export type Staff = { id: string; full_name: string; email: string | null; role: StaffRole };

export const PRICING_ROLES: StaffRole[] = ["admin", "finance"];
export const ALL_ROLES: StaffRole[] = ["admin", "sales", "china_team", "finance", "legal", "support"];
export const ROLE_AR: Record<StaffRole, string> = {
  admin: "مدير", finance: "مالية", sales: "مبيعات", china_team: "فريق الصين", legal: "قانوني", support: "خدمة عملاء",
};

/** The logged-in staff member, or null (not logged in / not a staff member / deactivated). */
export async function currentStaff(): Promise<Staff | null> {
  const supa = await authClient();
  const { data } = await supa.auth.getUser(); // verifies the JWT with Supabase
  if (!data.user) return null;
  const r = await db().from("staff").select("id, full_name, email, role").eq("auth_user_id", data.user.id).eq("active", true).maybeSingle();
  return (r.data as Staff | null) ?? null;
}

/** For pages: redirects to login if not allowed. */
export async function requireStaff(roles?: StaffRole[]): Promise<Staff> {
  const s = await currentStaff();
  if (!s) redirect("/admin/login");
  if (roles && !roles.includes(s.role)) redirect("/admin/login?e=role");
  return s;
}

/** For server actions: throws instead of redirecting. */
export async function assertStaff(roles: StaffRole[]): Promise<Staff> {
  const s = await currentStaff();
  if (!s || !roles.includes(s.role)) throw new Error("غير مصرح لك بالتعديل");
  return s;
}
