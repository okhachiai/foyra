"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/icon";
import { LOCALE_NAMES, LOCALES, THEME_COOKIE, type T } from "@/lib/i18n";
import { setLocaleAction } from "@/app/actions";
import { useI18n } from "./i18n";

type Entry = readonly [href: string, label: string, icon: IconName];

/** Main menu, by group (discreet titles in the sidebar). Labels are English source text, translated on render. */
const GROUPS = [
  ["Tracking", [["/dashboard", "Dashboard", "dashboard"], ["/budget", "Budget", "wallet"], ["/transactions", "Transactions", "transfers"]]],
  ["Assets", [["/savings", "Savings", "savings"], ["/loans", "Loans", "bank"]]],
  ["Planning", [["/calendar", "Calendar", "calendar"], ["/reports", "Reports", "reports"]]],
] as const satisfies readonly (readonly [string, readonly Entry[]])[];
const MAIN: readonly Entry[] = GROUPS.flatMap(([, items]): readonly Entry[] => items);

/** Mobile bottom bar: main destinations; the rest goes into "More". */
const TABS = ["/dashboard", "/budget", "/transactions", "/calendar"];
const SHORT: Record<string, string> = { "/dashboard": "Home" };

/** Pages under "Settings"; `admin`: admins only. */
const SETTINGS = [
  ["/settings", "General", false],
  ["/categories", "Categories", false],
  ["/charges", "Recurring", false],
  ["/members", "Members", true],
  ["/settings/ai", "AI", true],
  ["/profile", "Security", false],
] as const;

const isActive = (path: string, href: string) => path === href || path.startsWith(href + "/");
const inSettings = (path: string) => SETTINGS.some(([href]) => isActive(path, href));
const dueLabel = (t: T, n: number) => t(n > 1 ? "{n} payments due" : "{n} payment due", { n });

function Item({ href, label, icon, active, count, onClick }: { href: string; label: string; icon: IconName; active: boolean; count?: number; onClick?: () => void }) {
  const { t } = useI18n();
  return (
    <Link href={href} aria-current={active ? "page" : undefined} onClick={onClick}>
      <Icon name={icon} />
      {t(label)}
      {!!count && <span className="side-count" aria-label={dueLabel(t, count)}>{count}</span>}
    </Link>
  );
}

/** Sidebar main menu; `due`: unpaid payments of the month, shown on Calendar. */
export function Nav({ due }: { due: number }) {
  const path = usePathname();
  const { t } = useI18n();
  return (
    <nav aria-label={t("Main navigation")}>
      {GROUPS.map(([title, items]) => (
        <div key={title} className="side-group" role="group" aria-label={t(title)}>
          <span className="side-label" aria-hidden>{t(title)}</span>
          {items.map(([href, label, icon]) => (
            <Item key={href} href={href} label={label} icon={icon} active={isActive(path, href)} count={href === "/calendar" ? due : undefined} />
          ))}
        </div>
      ))}
    </nav>
  );
}

/** Settings link at the bottom of the sidebar, active on all its sub-pages. */
export function PrefsNav() {
  const path = usePathname();
  const { t } = useI18n();
  return (
    <nav aria-label={t("Preferences")}>
      <Item href="/settings" label="Settings" icon="settings" active={inSettings(path)} />
    </nav>
  );
}

/** Mobile bottom navigation + "More" menu (native popover: Escape, outside click, focus handled by the browser). */
export function TabBar({ due, logout }: { due: number; logout: React.ReactNode }) {
  const path = usePathname();
  const { t } = useI18n();
  const more = [...MAIN.filter(([href]) => !TABS.includes(href)), ["/settings", "Settings", "settings"] as const];
  const moreActive = more.some(([href]) => (href === "/settings" ? inSettings(path) : isActive(path, href)));
  const close = () => document.getElementById("more-menu")?.hidePopover();
  return (
    <nav className="tabbar" aria-label={t("Mobile navigation")}>
      {MAIN.filter(([href]) => TABS.includes(href)).map(([href, label, icon]) => (
        <Link key={href} href={href} aria-current={isActive(path, href) ? "page" : undefined}>
          <span className="tab-icon">
            <Icon name={icon} />
            {href === "/calendar" && due > 0 && <span className="tab-dot" aria-label={dueLabel(t, due)} />}
          </span>
          {t(SHORT[href] ?? label)}
        </Link>
      ))}
      <button type="button" popoverTarget="more-menu" className={moreActive ? "is-active" : undefined}>
        <span className="tab-icon"><Icon name="more" /></span>
        {t("More")}
      </button>
      <div id="more-menu" popover="auto" className="more-menu">
        {more.map(([href, label, icon]) => (
          <Item key={href} href={href} label={label} icon={icon} onClick={close}
            active={href === "/settings" ? inSettings(path) : isActive(path, href)} />
        ))}
        {logout}
      </div>
    </nav>
  );
}

/** Top bar breadcrumb: household / current page. */
export function Crumbs({ root }: { root: string }) {
  const path = usePathname();
  const { t } = useI18n();
  // Last match: /settings/ai wins over /settings.
  const page = [...MAIN, ...SETTINGS].findLast(([href]) => isActive(path, href))?.[1];
  return (
    <nav aria-label={t("Breadcrumb")} className="crumbs">
      <Link href="/dashboard">{root}</Link>
      {page && <><Icon name="chevron" className="size-3.5" /><span aria-current="page">{t(page)}</span></>}
    </nav>
  );
}

/** Contextual top bar action: quick add, except where the page already carries it. */
export function TopActions() {
  const path = usePathname();
  const { t } = useI18n();
  if (path === "/dashboard" || isActive(path, "/transactions")) return null;
  return (
    <Link href="/transactions/new" className="button top-add" aria-label={t("Add a transaction")}>
      <Icon name="plus" className="size-4" /><span>{t("Transaction")}</span>
    </Link>
  );
}

/** Light/dark switch: applied at once on <html>, remembered for a year in a cookie the root layout reads (no flash on reload). */
export function ThemeToggle() {
  const { t } = useI18n();
  const toggle = () => {
    const root = document.documentElement;
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  };
  return (
    <button type="button" className="ghost top-icon" onClick={toggle} aria-label={t("Switch light/dark mode")} title={t("Switch light/dark mode")}>
      <Icon name="moon" className="theme-moon size-[18px]" /><Icon name="sun" className="theme-sun size-[18px]" />
    </button>
  );
}

/** Compact language picker for the top bar; submits on change. */
export function LanguageSelect() {
  const { locale, t } = useI18n();
  return (
    <form action={setLocaleAction} className="top-lang">
      <select name="locale" defaultValue={locale} aria-label={t("Language")} onChange={(e) => e.currentTarget.form?.requestSubmit()}>
        {LOCALES.map((l) => <option key={l} value={l} lang={l}>{LOCALE_NAMES[l]}</option>)}
      </select>
    </form>
  );
}

/** Settings sub-navigation (tabs); Members and AI for admins only. */
export function SettingsNav({ admin }: { admin: boolean }) {
  const path = usePathname();
  const { t } = useI18n();
  const current = SETTINGS.findLast(([href]) => isActive(path, href))?.[0];
  return (
    <nav aria-label={t("Settings")} className="subnav">
      {SETTINGS.filter(([, , adminOnly]) => admin || !adminOnly).map(([href, label]) => (
        <Link key={href} href={href} aria-current={href === current ? "page" : undefined}>{t(label)}</Link>
      ))}
    </nav>
  );
}
