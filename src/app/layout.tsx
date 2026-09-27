import type { Metadata, Viewport } from "next";
import { Hind_Siliguri } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const hindSiliguri = Hind_Siliguri({
  variable: "--font-hind-siliguri",
  subsets: ["bengali", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Z-AI ফ্রি প্রাইভেট টিউটর",
  description:
    "বাংলাদেশের শিক্ষার্থীদের জন্য সম্পূর্ণ ফ্রি, বুদ্ধিমান AI প্রাইভেট টিউটর — পাঠ্যবই ভিত্তিক উত্তর, ধাপে ধাপে ম্যাথ সমাধান, বাংলা ভয়েস সাপোর্ট।",
  keywords: ["AI টিউটর", "ফ্রি টিউটর", "বাংলা", "NCTB", "গণিত", "বিজ্ঞান", "শিক্ষা"],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#059669",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="bn" suppressHydrationWarning>
      <body className={`${hindSiliguri.variable} font-hind antialiased bg-background text-foreground`}>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
