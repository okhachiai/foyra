import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Foyra",
    short_name: "Foyra",
    description: "Les comptes du foyer",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f7f3",
    theme_color: "#f5f7f3",
    // icon1.png est plein cadre, symbole dans la zone sûre (≤ 80 %) : valable aussi en maskable.
    icons: [
      { src: "/icon0.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon1.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon1.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
