import type { Metadata } from "next";
import { Shell } from "../../register/Shell";
import LoginForm from "./LoginForm";

export const metadata: Metadata = { title: "دخول الإدارة | هلال الشرق", robots: { index: false, follow: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const { e } = await searchParams;
  return (
    <Shell>
      <h2 className="mb-1 text-center text-xl font-bold text-[#0B1B3A]">لوحة الإدارة</h2>
      <p className="mb-6 text-center text-sm text-slate-500">سجّل الدخول بالإيميل وكلمة المرور</p>
      {e === "role" && (
        <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">الحساب ده مش عنده صلاحية على الصفحة دي.</p>
      )}
      <LoginForm />
    </Shell>
  );
}
