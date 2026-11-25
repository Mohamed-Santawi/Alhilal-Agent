"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, count = 0, children }: { href: string; count?: number; children: React.ReactNode }) {
  const active = usePathname().startsWith(href);
  return (
    <Link href={href} className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 ${active ? "bg-[#D4AF5A] font-bold text-[#0B1B3A]" : "bg-white/10 hover:bg-white/20"}`}>
      {children}
      {count > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-red-500 px-1 text-xs font-bold text-white">{count}</span>}
    </Link>
  );
}
