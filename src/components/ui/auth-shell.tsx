import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon";
import { LogoMark } from "./logo";
import { LanguageSwitch } from "./language-switch";
import { getI18n } from "@/lib/i18n-server";

const POINTS: readonly [IconName, string, string][] = [
  ["wallet", "Monthly budget", "Income, fixed charges, savings and variable envelopes."],
  ["calendar", "Due dates", "Recurring charges and loans tracked month by month."],
  ["shield", "No connected bank", "Nothing is paid or debited automatically."],
];

/** Public pages template (sign-in, setup): deep green brand panel + form card. */
export async function AuthShell({ title, subtitle, children, foot }: { title: string; subtitle: ReactNode; children: ReactNode; foot?: ReactNode }) {
  const { t } = await getI18n();
  return (
    <div className="auth">
      <aside className="auth-brand">
        <p className="flex items-center gap-3 text-xl font-bold"><span className="logo" aria-hidden><LogoMark /></span>Foyra</p>
        <div>
          <p className="auth-claim">{t("The household budget, clear and shared.")}</p>
          <ul className="auth-points">
            {POINTS.map(([icon, title, text]) => (
              <li key={title}><span className="kpi-icon hero"><Icon name={icon} className="size-4" /></span><span><b>{t(title)}</b>{t(text)}</span></li>
            ))}
          </ul>
        </div>
        <small>Foyra · {t("household budget management")}</small>
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
          <LanguageSwitch className="mt-4" />
        </div>
      </main>
    </div>
  );
}
