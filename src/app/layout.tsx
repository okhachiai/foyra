import type { Metadata, Viewport } from "next";
import { Urbanist } from "next/font/google";
import "./globals.css";
import { getI18n } from "@/lib/i18n-server";
import { I18nProvider } from "./i18n";

// Rounded geometric sans for the whole UI (headings, amounts, text).
const sans = Urbanist({ subsets: ["latin"], variable: "--font-sans" });

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: "Foyra",
    description: t("Household accounts"),
    // Installable on iOS via "Add to Home Screen"; opaque status bar = content never under the notch.
    appleWebApp: { capable: true, title: "Foyra", statusBarStyle: "default" },
  };
}
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover", // iOS safe areas (env(safe-area-inset-*))
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f7f3" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1412" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale, dir } = await getI18n();
  return (
    <html lang={locale} dir={dir} className={sans.variable}>
      <body><I18nProvider locale={locale}>{children}</I18nProvider></body>
    </html>
  );
}
