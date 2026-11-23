import type { Metadata } from "next";
import Link from "next/link";
import { requireStaff } from "@/lib/auth/staff";
import { signOut } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "لوحة الإدارة | هلال الشرق", robots: { index: false, follow: false } };

const ROLE_AR: Record<string, string> = { admin: "مدير", finance: "مالية", sales: "مبيعات", china_team: "فريق الصين", legal: "قانوني", support: "خدمة عملاء" };

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const me = await requireStaff();
  return (
    <div dir="rtl" lang="ar" className="min-h-dvh bg-slate-100 text-slate-800" style={{ fontFamily: "Tajawal, Tahoma, Arial, sans-serif" }}>
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap" />
      <header className="bg-[#0B1B3A] text-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-full border border-[#D4AF5A] text-lg">🌙</span>
            <div>
              <p className="font-extrabold text-[#E9C77B]">هلال الشرق — الإدارة</p>
              <p className="text-xs text-white/60">{me.full_name} · {ROLE_AR[me.role] ?? me.role}</p>
            </div>
          </div>
          <nav className="flex items-center gap-2 text-sm">
            <Link href="/admin/pricing" className="rounded-lg bg-white/10 px-3 py-1.5 hover:bg-white/20">الأسعار</Link>
            <form action={signOut}>
              <button className="rounded-lg px-3 py-1.5 text-white/70 hover:bg-white/10 hover:text-white">خروج</button>
            </form>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
