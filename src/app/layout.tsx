import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "هلال الشرق — لوحة الإدارة",
  description: "Hilal Alsharq AI Agent & Admin",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body className="antialiased font-sans">{children}</body>
    </html>
  );
}
