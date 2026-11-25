"use client";

import { useEffect, useRef, useState } from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "./actions";

/** Re-renders the server page every `ms` (new messages / tasks) while the tab is visible. */
export function AutoRefresh({ ms = 15000 }: { ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, ms);
    return () => clearInterval(t);
  }, [router, ms]);
  return null;
}

/** Keeps the chat scrolled to the newest message. */
export function ScrollToEnd({ dep }: { dep: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollIntoView({ block: "end" }); }, [dep]);
  return <div ref={ref} />;
}

type Action = (prev: ActionResult, fd: FormData) => Promise<ActionResult>;

/** Reply box: clears itself after a successful send; Ctrl/⌘+Enter sends. */
export function ReplyBox({ action, conversationId, disabled, reason }: { action: Action; conversationId: string; disabled: boolean; reason?: string }) {
  const [state, formAction, pending] = useActionState(action, null);
  const [text, setText] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) setText(""); }, [state]);

  if (disabled) return <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">{reason}</p>;
  return (
    <form ref={formRef} action={formAction} className="space-y-2">
      <input type="hidden" name="conversation_id" value={conversationId} />
      <div className="flex items-end gap-2">
        <textarea
          name="text" value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={4000}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) formRef.current?.requestSubmit(); }}
          placeholder="اكتب ردك للعميل… (Ctrl + Enter للإرسال)"
          className="min-h-12 flex-1 resize-y rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#D4AF5A] focus:ring-2 focus:ring-[#D4AF5A]/30"
        />
        <button disabled={pending || !text.trim()} className="rounded-xl bg-[#0B1B3A] px-5 py-3 text-sm font-bold text-[#E9C77B] disabled:opacity-40">
          {pending ? "..." : "إرسال"}
        </button>
      </div>
      {state && !state.ok && <p className="text-sm text-red-600">{state.msg}</p>}
      <p className="text-xs text-slate-400">عند الرد يتوقف الرد الآلي على هذا العميل 24 ساعة، أو حتى تضغط «إرجاع للبوت».</p>
    </form>
  );
}
