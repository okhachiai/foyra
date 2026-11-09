import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon";
import { LogoMark } from "./logo";

const POINTS: readonly [IconName, string, string][] = [
  ["wallet", "Budget mensuel", "Revenus, charges fixes, épargne et enveloppes variables."],
  ["calendar", "Échéances", "Récurrences et crédits suivis mois par mois."],
  ["shield", "Sans banque connectée", "Rien n’est payé ni prélevé automatiquement."],
];

/** Gabarit des pages publiques (connexion, installation) : panneau de marque vert profond + carte de formulaire. */
export function AuthShell({ title, subtitle, children, foot }: { title: string; subtitle: ReactNode; children: ReactNode; foot?: ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth-brand">
        <p className="flex items-center gap-3 text-xl font-bold"><span className="logo" aria-hidden><LogoMark /></span>Foyra</p>
        <div>
          <p className="auth-claim">Le budget du foyer, clair et partagé.</p>
          <ul className="auth-points">
            {POINTS.map(([icon, title, text]) => (
              <li key={title}><span className="kpi-icon hero"><Icon name={icon} className="size-4" /></span><span><b>{title}</b>{text}</span></li>
            ))}
          </ul>
        </div>
        <small>Foyra · gestion budgétaire du foyer</small>
      </aside>
      <main className="auth-main">
        <div className="card auth-card">
          <div className="mb-6 flex flex-col gap-3">
            <span className="logo lg:hidden" aria-hidden><LogoMark /></span>
            <div>
              <h1 className="m-0">{title}</h1>
              <p className="m-0 mt-1.5 text-muted">{subtitle}</p>
            </div>
          </div>
          {children}
          {foot && <p className="m-0 mt-6 border-t border-hairline pt-4 text-label text-muted">{foot}</p>}
        </div>
      </main>
    </div>
  );
}
