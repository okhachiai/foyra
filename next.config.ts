import type { NextConfig } from "next";

// APP_URL est lu au build (image Docker : argument de build) : origine publique autorisée pour les Server Actions.
const appHost = process.env.APP_URL ? new URL(process.env.APP_URL).host : undefined;

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  experimental: { serverActions: { allowedOrigins: appHost ? [appHost] : [] } },
};

export default nextConfig;
