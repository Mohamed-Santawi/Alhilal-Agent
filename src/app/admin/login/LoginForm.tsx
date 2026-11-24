"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useState } from "react";

export default function LoginForm() {
  // Always start empty — the admin types the email and password himself.
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!email.trim() || !password) return setError("يرجى كتابة البريد الإلكتروني وكلمة المرور");
    setBusy(true);
    const supa = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
    const { error } = await supa.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error) {
      setBusy(false);
      return setError(error.message.includes("Invalid") ? "البريد الإلكتروني أو كلمة المرور غير صحيحة" : "حدثت مشكلة، يرجى المحاولة مرة أخرى");
    }
    window.location.href = "/admin/pricing";
  }

  const input = "w-full rounded-xl border border-slate-300 px-4 py-3 text-base outline-none focus:border-[#D4AF5A] focus:ring-2 focus:ring-[#D4AF5A]/30";
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-slate-700">البريد الإلكتروني</span>
        <input type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" className={`${input} text-left`} />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-slate-700">كلمة المرور</span>
        <input type="password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className={`${input} text-left`} />
      </label>
      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      <button type="submit" disabled={busy}
        className="w-full rounded-xl bg-gradient-to-l from-[#B8923B] to-[#E0BE6E] py-3.5 text-lg font-bold text-[#0B1B3A] shadow-lg disabled:opacity-60">
        {busy ? "جاري الدخول..." : "دخول"}
      </button>
    </form>
  );
}
