import Link from "next/link";

export const TZ = "Asia/Riyadh";

export function when(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso), diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "الآن";
  if (diff < 3600) return `قبل ${Math.floor(diff / 60)} د`;
  const today = new Date().toLocaleDateString("en-GB", { timeZone: TZ }) === d.toLocaleDateString("en-GB", { timeZone: TZ });
  if (today) return d.toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("en-GB", { timeZone: TZ, day: "2-digit", month: "2-digit" });
}
export const stamp = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-GB", { timeZone: TZ, dateStyle: "short", timeStyle: "short" }) : "—";
export const sar = (x: unknown) => Number(x ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function PageTitle({ title, hint, children }: { title: string; hint?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-extrabold text-[#0B1B3A]">{title}</h1>
        {hint && <p className="mt-1 text-sm text-slate-500">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

export function Card({ title, children, className = "" }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl bg-white p-4 shadow-sm ${className}`}>
      {title && <h2 className="mb-3 font-extrabold text-[#0B1B3A]">{title}</h2>}
      {children}
    </section>
  );
}

const TONES = {
  gray: "bg-slate-100 text-slate-600", gold: "bg-[#FBF6EA] text-[#8A6A22]", green: "bg-emerald-100 text-emerald-700",
  red: "bg-red-100 text-red-700", blue: "bg-blue-100 text-blue-700", navy: "bg-[#0B1B3A] text-[#E9C77B]", amber: "bg-amber-100 text-amber-800",
} as const;
export function Badge({ tone = "gray", children }: { tone?: keyof typeof TONES; children: React.ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold ${TONES[tone]}`}>{children}</span>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-2xl bg-white p-8 text-center text-sm text-slate-500 shadow-sm">{children}</p>;
}

/** Tab-like filter links that keep the other query params. */
export function Tabs({ base, param, value, items, keep = {} }: {
  base: string; param: string; value: string; items: [string, string][]; keep?: Record<string, string | undefined>;
}) {
  return (
    <div className="flex flex-wrap gap-1 rounded-xl bg-white p-1 shadow-sm">
      {items.map(([v, label]) => {
        const q = new URLSearchParams(Object.entries({ ...keep, [param]: v }).filter(([, x]) => x) as [string, string][]);
        return (
          <Link key={v} href={`${base}?${q}`}
            className={`rounded-lg px-3 py-1.5 text-sm ${value === v ? "bg-[#0B1B3A] font-bold text-[#E9C77B]" : "text-slate-600 hover:bg-slate-100"}`}>
            {label}
          </Link>
        );
      })}
    </div>
  );
}

export function SearchBox({ base, q, placeholder, hidden = {} }: { base: string; q?: string; placeholder: string; hidden?: Record<string, string | undefined> }) {
  return (
    <form action={base} className="flex gap-2">
      {Object.entries(hidden).map(([k, v]) => v && <input key={k} type="hidden" name={k} value={v} />)}
      <input name="q" defaultValue={q} placeholder={placeholder}
        className="w-64 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#D4AF5A] focus:ring-2 focus:ring-[#D4AF5A]/30" />
      <button className="rounded-lg bg-[#0B1B3A] px-4 py-2 text-sm font-bold text-[#E9C77B]">بحث</button>
    </form>
  );
}

/** Strips PostgREST filter syntax characters from free text search. */
export const safeQ = (q?: string) => (q ?? "").replace(/[%,()*\\:."']/g, " ").trim().slice(0, 60);

export const KIND_AR: Record<string, string> = { air: "جوي ✈️", lcl: "بحري LCL 🚢", fcl: "حاوية كاملة 📦" };
export const QUOTE_STATUS: Record<string, [string, keyof typeof TONES]> = {
  estimate: ["تسعيرة", "gray"], accepted: ["طلب مؤكد", "green"], expired: ["منتهية", "red"], requested: ["طلب عرض سعر", "gold"],
};
