/** Branded page frame (navy + gold, like the Hilal Alsharq identity). */
export function Shell({ children, code }: { children: React.ReactNode; code?: string }) {
  return (
    <div dir="rtl" lang="ar" className="min-h-dvh bg-[#0B1B3A] bg-[radial-gradient(ellipse_at_top,#1B3366_0%,#0B1B3A_60%)] px-4 py-6 sm:py-10">
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap" />
      <div className="mx-auto max-w-xl" style={{ fontFamily: "Tajawal, Tahoma, Arial, sans-serif" }}>
        <header className="text-center mb-6">
          <div className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-full border-2 border-[#D4AF5A] text-3xl shadow-[0_0_30px_rgba(212,175,90,0.25)]">
            🌙
          </div>
          <h1 className="text-2xl font-extrabold text-[#E9C77B]">هلال الشرق للتجارة</h1>
          <p className="text-xs tracking-[0.25em] text-[#C9B27A]/80 mt-1">HILAL ALSHARQ TRADING CO., LTD</p>
          {code && (
            <p className="mt-3 inline-block rounded-full bg-white/10 px-4 py-1 text-sm text-white/90">
              رقم العميل: <span className="font-bold text-[#E9C77B]" dir="ltr">{code}</span>
            </p>
          )}
        </header>
        <main className="rounded-2xl bg-white p-5 sm:p-7 shadow-2xl">{children}</main>
        <p className="mt-5 text-center text-xs text-white/50">بياناتك محمية ولن تُشارك إلا لتنفيذ طلباتك</p>
      </div>
    </div>
  );
}
