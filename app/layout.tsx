import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "每日AI热点速递",
  description: "每天自动汇总AI科技热点、提问并生成点评"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-[#fdfbf7] text-slate-900 antialiased">
        <main className="mx-auto max-w-3xl px-5 py-12 md:py-16">{children}</main>
      </body>
    </html>
  );
}
