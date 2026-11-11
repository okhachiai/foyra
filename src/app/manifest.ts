import type { MetadataRoute } from "next";
import { getI18n } from "@/lib/i18n-server";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const { t, locale, dir } = await getI18n();
  return {
    lang: locale,
    dir,
    name: "Foyra",
    short_name: "Foyra",
    description: t("Household accounts"),
    start_url: "/",
    display: "standalone",
    background_color: "#f5f7f3",
    theme_color: "#f5f7f3",
    // icon1.png is full-bleed, symbol within the safe zone (≤ 80%): also valid as maskable.
    icons: [
      { src: "/icon0.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon1.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon1.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
