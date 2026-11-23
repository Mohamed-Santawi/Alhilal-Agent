"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { ActionResult } from "./actions";

type Action = (prev: ActionResult, fd: FormData) => Promise<ActionResult>;

/** A form wired to a server action, showing "saving…" and the result message. */
export function ActionForm({ action, children, className = "", confirm }: { action: Action; children: React.ReactNode; className?: string; confirm?: string }) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form
      action={formAction}
      className={className}
      onSubmit={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}
    >
      {children}
      {state && <p className={`basis-full text-sm ${state.ok ? "text-emerald-700" : "text-red-600"}`}>{state.msg}</p>}
    </form>
  );
}

export function SaveButton({ label = "حفظ", variant = "gold" }: { label?: string; variant?: "gold" | "ghost" | "danger" }) {
  const { pending } = useFormStatus();
  const styles = {
    gold: "bg-[#0B1B3A] text-[#E9C77B] hover:bg-[#13285A]",
    ghost: "border border-slate-300 text-slate-700 hover:bg-slate-50",
    danger: "border border-red-200 text-red-600 hover:bg-red-50",
  }[variant];
  return (
    <button type="submit" disabled={pending} className={`rounded-lg px-4 py-2 text-sm font-bold transition disabled:opacity-50 ${styles}`}>
      {pending ? "..." : label}
    </button>
  );
}
