import type { Metadata } from "next";
import { peekFormToken } from "@/lib/forms/tokens";
import { db } from "@/lib/supabase";
import { privacyUrl } from "@/lib/env";
import RegisterForm from "./RegisterForm";
import { Shell } from "./Shell";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "التسجيل | هلال الشرق للتجارة",
  robots: { index: false, follow: false },
};

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t = "" } = await searchParams;
  const tok = await peekFormToken(t, "register");

  if (!tok) {
    return (
      <Shell>
        <div className="text-center py-6">
          <div className="text-5xl mb-4">⏳</div>
          <h2 className="text-xl font-bold text-[#0B1B3A] mb-2">انتهت صلاحية الرابط أو تم استخدامه</h2>
          <p className="text-slate-600 leading-7">
            يرجى العودة إلى محادثة الواتساب وإرسال أي رسالة، وسيصلك رابط تسجيل جديد.
          </p>
        </div>
      </Shell>
    );
  }

  const cust = await db().from("customers").select("code").eq("id", tok.customer_id).single();

  return (
    <Shell code={cust.data?.code}>
      <RegisterForm token={t} privacyUrl={privacyUrl() ?? "/privacy"} />
    </Shell>
  );
}
