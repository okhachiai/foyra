"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

const LINKS = [
  ["/tableau-de-bord", "Tableau de bord"],
  ["/budget", "Budget"],
  ["/accounts", "Comptes"],
  ["/calendrier", "Calendrier"],
  ["/credits", "Crédits"],
  ["/parametres", "Paramètres"],
] as const;

/** Pages rattachées à « Paramètres » dans la navigation. */
export const SETTINGS = [
  ["/parametres", "Général"],
  ["/accounts", "Comptes"],
  ["/categories", "Catégories"],
  ["/charges", "Récurrences"],
  ["/members", "Membres"],
  ["/profil", "Mot de passe"],
] as const;

const isActive = (path: string, href: string) => path === href || path.startsWith(href + "/");

export function Nav() {
  const path = usePathname();
  const settings = SETTINGS.some(([href]) => href !== "/accounts" && isActive(path, href));
  return (
    <nav aria-label="Navigation principale">
      {LINKS.map(([href, label]) => (
        <Link key={href} href={href} aria-current={(href === "/parametres" ? settings : isActive(path, href)) ? "page" : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  );
}

/** Sous-navigation des paramètres ; Membres réservé aux admins. */
export function SettingsNav({ admin }: { admin: boolean }) {
  const path = usePathname();
  return (
    <nav aria-label="Paramètres" className="mb-6 flex flex-wrap gap-2">
      {SETTINGS.filter(([href]) => admin || href !== "/members").map(([href, label]) => (
        <Link
          key={href} href={href} aria-current={isActive(path, href) ? "page" : undefined}
          className="rounded-full border border-border px-3 py-1.5 text-sm text-muted no-underline transition-colors hover:text-heading aria-[current=page]:border-accent/60 aria-[current=page]:bg-accent/15 aria-[current=page]:text-heading"
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

/** Position du curseur dans la carte survolée (--x / --y), lue par le halo CSS. */
export function Spotlight() {
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const card = (e.target as Element).closest?.<HTMLElement>(".total, .list, .table-scroll, .card");
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty("--x", `${e.clientX - r.left}px`);
      card.style.setProperty("--y", `${e.clientY - r.top}px`);
    };
    document.addEventListener("pointermove", move, { passive: true });
    return () => document.removeEventListener("pointermove", move);
  }, []);
  return null;
}
