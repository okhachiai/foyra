import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getShell } from "@/lib/dashboard";
import { monthLabel, parseDay, todayIn } from "@/lib/ledger";
import { formatCents } from "@/lib/money";
import { logoutAction } from "@/app/actions";
import { Crumbs, Nav, PrefsNav, TabBar, TopActions } from "@/app/nav";
import { Icon } from "@/components/ui/icon";
import { LogoMark } from "@/components/ui/logo";
import { ProgressBar } from "@/components/ui/progress";


/** Coquille des pages connectées (groupe de routes (app)) : barre latérale + barre du haut. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const { month, plan, due } = await getShell(user.householdId, parseDay(todayIn(user.household.timezone))!);
  const money = (cents: number) => formatCents(cents, user.household.currency);
  // Ligne la plus en dépassement (left le plus négatif), si une ligne dépasse.
  const worst = plan?.lines.reduce<(typeof plan.lines)[number] | null>((w, l) => (l.left < (w?.left ?? 0) ? l : w), null);
  const initial = user.name.trim().charAt(0).toUpperCase();
  const logout = (
    <form action={logoutAction}>
      <button type="submit" className="link"><Icon name="logout" />Déconnexion</button>
    </form>
  );

  return (
    <div className="app">
      <aside className="side">
        <Link href="/tableau-de-bord" className="brand">
          <span className="logo" aria-hidden><LogoMark /></span>
          <span className="min-w-0">Foyra<small className="eyebrow">{user.household.name}</small></span>
        </Link>
        <Nav due={due} />

        {/* Plan de dépenses du mois en cours : mêmes chiffres que la carte du tableau de bord. */}
        <section className="side-check" aria-label="Budget du mois">
          <p className="side-check-title"><Icon name="shield" className="size-4" />Budget du mois</p>
          {plan && plan.planned > 0 ? (
            <>
              <strong className={plan.left < 0 ? "neg" : undefined}>
                {plan.left < 0 ? `Dépassé de ${money(-plan.left)}` : `${money(plan.left)} restants`}
              </strong>
              <ProgressBar value={plan.actual} max={plan.planned} label="Part du prévu dépensée" />
              <small>{Math.round((plan.actual / plan.planned) * 100)} % du prévu utilisé · {monthLabel(month)}</small>
              {worst && <small className="neg">{worst.label} : dépassé de {money(-worst.left)}</small>}
            </>
          ) : (
            <>
              <small>Aucun budget de dépenses pour {monthLabel(month)}.</small>
              <Link href="/budget">Préparer le budget</Link>
            </>
          )}
        </section>

        <div className="side-foot">
          <PrefsNav />
          {logout}
        </div>
      </aside>
      <div className="shell">
        <a href="#contenu" className="skip">Aller au contenu</a>
        <header className="topbar">
          <Link href="/tableau-de-bord" className="top-brand" aria-label="Foyra, tableau de bord">
            <span className="logo" aria-hidden><LogoMark /></span>
          </Link>
          <Crumbs root={user.household.name} />
          <div className="top-end">
            <TopActions />
            <Link href="/profil" className="who" aria-label={`Mon compte : ${user.name}`}>
              <span className="avatar" aria-hidden>{initial}</span>
              <span className="who-name">{user.name}<small>{user.household.name} · {user.role === "ADMIN" ? "Administrateur" : "Membre"}</small></span>
            </Link>
          </div>
        </header>
        <main id="contenu" tabIndex={-1}>{children}</main>
        <TabBar due={due} logout={logout} />
      </div>
    </div>
  );
}
