import type { Metadata, Viewport } from "next";
import { Urbanist } from "next/font/google";
import "./globals.css";
import { cookies } from "next/headers";
import { getI18n } from "@/lib/i18n-server";
import { THEME_COOKIE } from "@/lib/i18n";
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

// No explicit choice: follow the system theme (before first paint, and live on change).
const followSystem = `(()=>{const d=document.documentElement,m=matchMedia("(prefers-color-scheme: dark)"),s=()=>{if(!document.cookie.includes("${THEME_COOKIE}="))d.dataset.theme=m.matches?"dark":"light"};s();m.addEventListener("change",s)})()`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale, dir } = await getI18n();
  const theme = (await cookies()).get(THEME_COOKIE)?.value;
  return (
    // suppressHydrationWarning: data-theme may be set by the script before hydration.
    <html lang={locale} dir={dir} className={sans.variable} data-theme={theme === "dark" || theme === "light" ? theme : undefined} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: followSystem }} /></head>
      <body><I18nProvider locale={locale}>{children}</I18nProvider></body>
    </html>
  );
}
