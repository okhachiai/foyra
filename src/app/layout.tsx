import type { Metadata, Viewport } from "next";
import "./globals.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Foyra", description: "Les comptes du foyer" };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
