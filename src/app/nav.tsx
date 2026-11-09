"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/icon";

type Entry = readonly [href: string, label: string, icon: IconName];

/** Menu principal, par groupes (titres discrets dans la barre latérale). */
const GROUPS = [
  ["Suivi", [["/tableau-de-bord", "Tableau de bord", "dashboard"], ["/budget", "Budget", "wallet"], ["/operations", "Opérations", "transfers"]]],
  ["Patrimoine", [["/epargne", "Épargne", "savings"], ["/credits", "Crédits", "bank"]]],
  ["Planification", [["/calendrier", "Calendrier", "calendar"], ["/rapports", "Rapports", "reports"]]],
] as const satisfies readonly (readonly [string, readonly Entry[]])[];
const MAIN: readonly Entry[] = GROUPS.flatMap(([, items]): readonly Entry[] => items);

/** Barre inférieure mobile : destinations principales ; le reste passe dans « Plus ». */
const TABS = ["/tableau-de-bord", "/budget", "/operations", "/calendrier"];
const SHORT: Record<string, string> = { "/tableau-de-bord": "Accueil" };

/** Pages rattachées à « Paramètres » ; `admin` : réservée aux administrateurs. */
const SETTINGS = [
  ["/parametres", "Général", false],
  ["/categories", "Catégories", false],
  ["/charges", "Récurrences", false],
  ["/members", "Membres", true],
  ["/parametres/ia", "IA", true],
  ["/profil", "Sécurité", false],
] as const;

const isActive = (path: string, href: string) => path === href || path.startsWith(href + "/");
const inSettings = (path: string) => SETTINGS.some(([href]) => isActive(path, href));
const dueLabel = (n: number) => `${n} échéance${n > 1 ? "s" : ""} à payer`;

function Item({ href, label, icon, active, count, onClick }: { href: string; label: string; icon: IconName; active: boolean; count?: number; onClick?: () => void }) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined} onClick={onClick}>
      <Icon name={icon} />
      {label}
      {!!count && <span className="side-count" aria-label={dueLabel(count)}>{count}</span>}
    </Link>
  );
}

/** Menu principal de la barre latérale ; `due` : échéances du mois non payées, affichées sur Calendrier. */
export function Nav({ due }: { due: number }) {
  const path = usePathname();
  return (
    <nav aria-label="Navigation principale">
      {GROUPS.map(([title, items]) => (
        <div key={title} className="side-group" role="group" aria-label={title}>
          <span className="side-label" aria-hidden>{title}</span>
          {items.map(([href, label, icon]) => (
            <Item key={href} href={href} label={label} icon={icon} active={isActive(path, href)} count={href === "/calendrier" ? due : undefined} />
          ))}
        </div>
      ))}
    </nav>
  );
}

/** Lien Paramètres du bas de la barre latérale, actif sur toutes ses sous-pages. */
export function PrefsNav() {
  const path = usePathname();
  return (
    <nav aria-label="Préférences">
      <Item href="/parametres" label="Paramètres" icon="settings" active={inSettings(path)} />
    </nav>
  );
}

/** Barre de navigation inférieure (mobile) + menu « Plus » (popover natif : Échap, clic extérieur, focus gérés par le navigateur). */
export function TabBar({ due, logout }: { due: number; logout: React.ReactNode }) {
  const path = usePathname();
  const more = [...MAIN.filter(([href]) => !TABS.includes(href)), ["/parametres", "Paramètres", "settings"] as const];
  const moreActive = more.some(([href]) => (href === "/parametres" ? inSettings(path) : isActive(path, href)));
  const close = () => document.getElementById("more-menu")?.hidePopover();
  return (
    <nav className="tabbar" aria-label="Navigation mobile">
      {MAIN.filter(([href]) => TABS.includes(href)).map(([href, label, icon]) => (
        <Link key={href} href={href} aria-current={isActive(path, href) ? "page" : undefined}>
          <span className="tab-icon">
            <Icon name={icon} />
            {href === "/calendrier" && due > 0 && <span className="tab-dot" aria-label={dueLabel(due)} />}
          </span>
          {SHORT[href] ?? label}
        </Link>
      ))}
      <button type="button" popoverTarget="more-menu" className={moreActive ? "is-active" : undefined}>
        <span className="tab-icon"><Icon name="more" /></span>
        Plus
      </button>
      <div id="more-menu" popover="auto" className="more-menu">
        {more.map(([href, label, icon]) => (
          <Item key={href} href={href} label={label} icon={icon} onClick={close}
            active={href === "/parametres" ? inSettings(path) : isActive(path, href)} />
        ))}
        {logout}
      </div>
    </nav>
  );
}

/** Fil d'Ariane de la barre du haut : foyer / page courante. */
export function Crumbs({ root }: { root: string }) {
  const path = usePathname();
  // Dernière correspondance : /parametres/ia l'emporte sur /parametres.
  const page = [...MAIN, ...SETTINGS].findLast(([href]) => isActive(path, href))?.[1];
  return (
    <nav aria-label="Fil d’Ariane" className="crumbs">
      <Link href="/tableau-de-bord">{root}</Link>
      {page && <><Icon name="chevron" className="size-3.5" /><span aria-current="page">{page}</span></>}
    </nav>
  );
}

/** Action contextuelle de la barre du haut : ajout rapide, sauf là où la page la porte déjà. */
export function TopActions() {
  const path = usePathname();
  if (path === "/tableau-de-bord" || isActive(path, "/operations")) return null;
  return (
    <Link href="/operations/new" className="button top-add" aria-label="Ajouter une opération">
      <Icon name="plus" className="size-4" /><span>Opération</span>
    </Link>
  );
}

/** Sous-navigation des paramètres (onglets) ; Membres et IA réservés aux admins. */
export function SettingsNav({ admin }: { admin: boolean }) {
  const path = usePathname();
  const current = SETTINGS.findLast(([href]) => isActive(path, href))?.[0];
  return (
    <nav aria-label="Paramètres" className="subnav">
      {SETTINGS.filter(([, , adminOnly]) => admin || !adminOnly).map(([href, label]) => (
        <Link key={href} href={href} aria-current={href === current ? "page" : undefined}>{label}</Link>
      ))}
    </nav>
  );
}
