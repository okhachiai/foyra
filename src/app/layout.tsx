import type { Metadata, Viewport } from "next";
import { Urbanist } from "next/font/google";
import "./globals.css";

// Sans géométrique arrondie, pour toute l'interface (titres, montants, texte).
const sans = Urbanist({ subsets: ["latin"], variable: "--font-sans" });

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Foyra",
  description: "Les comptes du foyer",
  // Installable sur iOS via « Sur l'écran d'accueil » ; barre de statut opaque = contenu jamais sous l'encoche.
  appleWebApp: { capable: true, title: "Foyra", statusBarStyle: "default" },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f7f3" },
    { media: "(prefers-color-scheme: dark)", color: "#111613" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={sans.variable}>
      <body>{children}</body>
    </html>
  );
}
