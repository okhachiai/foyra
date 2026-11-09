"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/icon";

const MAIN = [
  ["/tableau-de-bord", "Tableau de bord", "dashboard"],
  ["/budget", "Budget", "wallet"],
  ["/operations", "Opérations", "transfers"],
  ["/epargne", "Épargne", "savings"],
  ["/credits", "Crédits", "bank"],
  ["/calendrier", "Calendrier", "calendar"],
  ["/rapports", "Rapports", "reports"],
] as const satisfies readonly (readonly [string, string, IconName])[];

/** Pages rattachées à « Paramètres » dans la navigation. */
export const SETTINGS = [
  ["/parametres", "Général"],
  ["/categories", "Catégories"],
  ["/charges", "Récurrences"],
  ["/members", "Membres"],
  ["/profil", "Mot de passe"],
] as const;

const isActive = (path: string, href: string) => path === href || path.startsWith(href + "/");

export function Nav() {
  const path = usePathname();
  const settings = SETTINGS.some(([href]) => isActive(path, href));
  const item = (href: string, label: string, icon: IconName, active: boolean) => (
    <Link key={href} href={href} aria-current={active ? "page" : undefined}>
      <Icon name={icon} />{label}
    </Link>
  );
  return (
    <nav aria-label="Navigation principale">
      <span className="side-label">Menu principal</span>
      {MAIN.map(([href, label, icon]) => item(href, label, icon, isActive(path, href)))}
      <span className="side-label">Préférences</span>
      {item("/parametres", "Paramètres", "settings", settings)}
    </nav>
  );
}

/** Fil d'Ariane de la barre du haut : foyer › page courante. */
export function Crumbs({ root }: { root: string }) {
  const path = usePathname();
  const page = [...MAIN, ...SETTINGS].find(([href]) => isActive(path, href))?.[1];
  return (
    <nav aria-label="Fil d’Ariane" className="crumbs">
      <Link href="/tableau-de-bord">{root}</Link>
      {page && <><Icon name="chevron" className="size-4" /><span aria-current="page">{page}</span></>}
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
          className="rounded-[10px] border border-border bg-panel px-3.5 py-1.5 text-sm font-medium text-muted no-underline transition-colors hover:text-heading aria-[current=page]:border-accent aria-[current=page]:bg-accent aria-[current=page]:text-white"
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
