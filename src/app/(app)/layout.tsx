import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getShell } from "@/lib/dashboard";
import { monthLabel, parseDay, todayIn } from "@/lib/ledger";
import { formatCents } from "@/lib/money";
import { getI18n } from "@/lib/i18n-server";
import { logoutAction } from "@/app/actions";
import { Crumbs, Nav, PrefsNav, TabBar, TopActions } from "@/app/nav";
import { Icon } from "@/components/ui/icon";
import { LogoMark } from "@/components/ui/logo";
import { ProgressBar } from "@/components/ui/progress";


/** Shell of signed-in pages (route group (app)): sidebar + top bar. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const { month, plan, due } = await getShell(user.householdId, parseDay(todayIn(user.household.timezone))!);
  const { t, intl } = await getI18n();
  const money = (cents: number) => formatCents(cents, user.household.currency, intl);
  // Most overspent line (most negative left), if any line is over.
  const worst = plan?.lines.reduce<(typeof plan.lines)[number] | null>((w, l) => (l.left < (w?.left ?? 0) ? l : w), null);
  const initial = user.name.trim().charAt(0).toUpperCase();
  const logout = (
    <form action={logoutAction}>
      <button type="submit" className="link"><Icon name="logout" />{t("Sign out")}</button>
    </form>
  );

  return (
    <div className="app">
      <aside className="side">
        <Link href="/dashboard" className="brand">
          <span className="logo" aria-hidden><LogoMark /></span>
          <span className="min-w-0">Foyra<small className="eyebrow">{user.household.name}</small></span>
        </Link>
        <Nav due={due} />

        {/* Current month's spending plan: same figures as the dashboard card. */}
        <section className="side-check" aria-label={t("Monthly budget")}>
          <p className="side-check-title"><Icon name="shield" className="size-4" />{t("Monthly budget")}</p>
          {plan && plan.planned > 0 ? (
            <>
              <strong className={plan.left < 0 ? "neg" : undefined}>
                {plan.left < 0 ? t("Over by {amount}", { amount: money(-plan.left) }) : t("{amount} left", { amount: money(plan.left) })}
              </strong>
              <ProgressBar value={plan.actual} max={plan.planned} label={t("Share of planned spent")} />
              <small>{t("{pct}% of planned used", { pct: Math.round((plan.actual / plan.planned) * 100) })} · {monthLabel(month, intl)}</small>
              {worst && <small className="neg">{worst.label}: {t("over by {amount}", { amount: money(-worst.left) })}</small>}
            </>
          ) : (
            <>
              <small>{t("No spending budget for {month}.", { month: monthLabel(month, intl) })}</small>
              <Link href="/budget">{t("Prepare the budget")}</Link>
            </>
          )}
        </section>

        <div className="side-foot">
          <PrefsNav />
          {logout}
        </div>
      </aside>
      <div className="shell">
        <a href="#content" className="skip">{t("Skip to content")}</a>
        <header className="topbar">
          <Link href="/dashboard" className="top-brand" aria-label={t("Foyra, dashboard")}>
            <span className="logo" aria-hidden><LogoMark /></span>
          </Link>
          <Crumbs root={user.household.name} />
          <div className="top-end">
            <TopActions />
            <Link href="/profile" className="who" aria-label={t("My account: {name}", { name: user.name })}>
              <span className="avatar" aria-hidden>{initial}</span>
              <span className="who-name">{user.name}<small>{user.household.name} · {t(user.role === "ADMIN" ? "Administrator" : "Member")}</small></span>
            </Link>
          </div>
        </header>
        <main id="content" tabIndex={-1}>{children}</main>
        <TabBar due={due} logout={logout} />
      </div>
    </div>
  );
}
