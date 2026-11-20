import { readFileSync } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "سياسة الخصوصية | Privacy Policy — Hilal Alsharq" };
export const dynamic = "force-static";

/** Renders src/content/privacy-policy.md (Arabic section, then English after the ---- line). */
export default function PrivacyPage() {
  const raw = readFileSync(path.join(process.cwd(), "src/content/privacy-policy.md"), "utf8");
  const [ar, en] = raw.split(/\n-{10,}\n/);
  return (
    <main className="mx-auto max-w-3xl px-5 py-10 leading-8 text-slate-800">
      <Section text={ar} dir="rtl" />
      {en && (<><hr className="my-12" /><Section text={en} dir="ltr" /></>)}
    </main>
  );
}

function Section({ text, dir }: { text: string; dir: "rtl" | "ltr" }) {
  const lines = text.trim().split("\n");
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul key={blocks.length} className="list-disc ps-6 space-y-1">{list.map((l, i) => <li key={i}>{l}</li>)}</ul>);
    list = [];
  };
  lines.forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith("- ")) return void list.push(t.slice(2));
    flush();
    if (!t) return;
    if (i === 0) blocks.push(<h1 key={blocks.length} className="text-2xl font-bold mb-2">{t}</h1>);
    else if (/^\d+\.\s/.test(t)) blocks.push(<h2 key={blocks.length} className="text-lg font-bold mt-8 mb-2">{t}</h2>);
    else blocks.push(<p key={blocks.length} className="mb-3">{t}</p>);
  });
  flush();
  return <section dir={dir} lang={dir === "rtl" ? "ar" : "en"}>{blocks}</section>;
}
