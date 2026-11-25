import type { Metadata } from "next";
import { requireStaff, PRICING_ROLES, ROLE_AR } from "@/lib/auth/staff";
import { db } from "@/lib/supabase";
import { signOut } from "../actions";
import { NavLink } from "./nav";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "لوحة الإدارة | هلال الشرق", robots: { index: false, follow: false } };

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const me = await requireStaff();
  const [tasks, chats] = await Promise.all([
    db().from("tasks").select("id", { count: "exact", head: true }).in("status", ["open", "in_progress", "escalated"]),
    db().from("staff_inbox").select("id", { count: "exact", head: true }).eq("mode", "human").gt("unread", 0),
  ]);

  return (
    <div dir="rtl" lang="ar" className="min-h-dvh bg-slate-100 text-slate-800" style={{ fontFamily: "Tajawal, Tahoma, Arial, sans-serif" }}>
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap" />
      <header className="bg-[#0B1B3A] text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-full border border-[#D4AF5A] text-lg">🌙</span>
            <div>
              <p className="font-extrabold text-[#E9C77B]">هلال الشرق — الإدارة</p>
              <p className="text-xs text-white/60">{me.full_name} · {ROLE_AR[me.role] ?? me.role}</p>
            </div>
          </div>
          <nav className="flex flex-wrap items-center gap-1 text-sm">
            <NavLink href="/admin/inbox" count={chats.count ?? 0}>المحادثات</NavLink>
            <NavLink href="/admin/tasks" count={tasks.count ?? 0}>المهام</NavLink>
            <NavLink href="/admin/quotes">التسعيرات</NavLink>
            <NavLink href="/admin/customers">العملاء</NavLink>
            {PRICING_ROLES.includes(me.role) && <NavLink href="/admin/pricing">الأسعار</NavLink>}
            {me.role === "admin" && <NavLink href="/admin/staff">الموظفون</NavLink>}
            <form action={signOut}>
              <button className="rounded-lg px-3 py-1.5 text-white/70 hover:bg-white/10 hover:text-white">خروج</button>
            </form>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
