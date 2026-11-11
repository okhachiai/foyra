import type { NextConfig } from "next";

// APP_URL est lu au build (image Docker : argument de build) : origine publique autorisée pour les Server Actions.
const appHost = process.env.APP_URL ? new URL(process.env.APP_URL).host : undefined;

// Tous les appels externes (LLM, etc.) partent du serveur : le navigateur ne parle qu'à 'self'.
// 'unsafe-inline' sur script-src : Next injecte ses scripts d'hydratation inline (nonce = rendu dynamique forcé via middleware).
// 'unsafe-eval' uniquement en dev (React Refresh). Pas de upgrade-insecure-requests ni HSTS : l'instance locale tourne en http,
// le TLS est l'affaire du reverse proxy.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  experimental: { serverActions: { allowedOrigins: appHost ? [appHost] : [] } },
  headers: async () => [{ source: "/:path*", headers: securityHeaders }],
  // Former French URLs (bookmarks, installed app) → English routes.
  redirects: async () =>
    [
      ["/tableau-de-bord", "/dashboard"], ["/operations", "/transactions"], ["/epargne", "/savings"], ["/credits", "/loans"],
      ["/calendrier", "/calendar"], ["/rapports", "/reports"], ["/parametres/ia", "/settings/ai"], ["/parametres", "/settings"], ["/profil", "/profile"],
    ].flatMap(([from, to]) => [
      { source: from, destination: to, permanent: true },
      { source: `${from}/:path*`, destination: `${to}/:path*`, permanent: true },
    ]),
};

export default nextConfig;
