import type { Metadata } from "next";
import { peekFormToken } from "@/lib/forms/tokens";
import { db } from "@/lib/supabase";
import { getShippingSettings, listCategoryOptions } from "@/lib/shipping/repo";
import { Shell } from "../register/Shell";
import QuoteForm from "./QuoteForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "حاسبة أسعار الشحن | هلال الشرق للتجارة",
  robots: { index: false, follow: false },
};

export default async function QuotePage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t = "" } = await searchParams;
  const tok = await peekFormToken(t, "quote");

  if (!tok) {
    return (
      <Shell>
        <div className="text-center py-6">
          <div className="text-5xl mb-4">⏳</div>
          <h2 className="text-xl font-bold text-[#0B1B3A] mb-2">الرابط انتهى</h2>
          <p className="text-slate-600 leading-7">ارجع لمحادثة الواتساب واختار «حاسبة أسعار الشحن» من القايمة، وهيوصلك رابط جديد.</p>
        </div>
      </Shell>
    );
  }

  const [categories, settings, cust] = await Promise.all([
    listCategoryOptions(),
    getShippingSettings(),
    db().from("customers").select("code, registration_complete").eq("id", tok.customer_id).single(),
  ]);

  return (
    <Shell code={cust.data?.registration_complete ? cust.data.code : undefined}>
      <QuoteForm
        token={t}
        categories={categories}
        samples={settings.prices_are_samples}
        divisor={settings.air_volumetric_divisor}
      />
    </Shell>
  );
}
