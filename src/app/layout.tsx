import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Spotlight } from "./nav";

const sans = Geist({ subsets: ["latin"], variable: "--font-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Foyra", description: "Les comptes du foyer" };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${sans.variable} ${mono.variable}`}>
      <body><Spotlight />{children}</body>
    </html>
  );
}
