import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { formatMonth, parseMonth } from "@/lib/budget";
import { formatDay, frDate, payers, todayIn } from "@/lib/ledger";
import { formatCents } from "@/lib/money";
import { getSavings, type SavingsMonth } from "@/lib/savings";
import { Badge } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { DateTile } from "@/components/ui/date-tile";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { MonthNav } from "@/components/ui/month-nav";
import { PageHeader } from "@/components/ui/page-header";
import { ProgressBar } from "@/components/ui/progress";
import { Stat } from "@/components/ui/stat";
import { addSavingAction } from "@/app/actions";
import { ActionForm, Field, SharedCheck } from "@/app/form";

const monthLabel = (key: string) => frDate({ month: "long", year: "numeric" }).format(new Date(`${key}-01T00:00:00Z`));
const shortMonth = (key: string) => frDate({ month: "short" }).format(new Date(`${key}-01T00:00:00Z`));

/** Barres mensuelles : versé (plein) devant le prévu (contour). HTML/CSS, lisible à toute largeur. */
function MonthBars({ series, money }: { series: SavingsMonth[]; money: (c: number) => string }) {
  const max = Math.max(1, ...series.flatMap((s) => [s.actual, s.planned]));
  const h = (v: number) => `${(v / max) * 100}%`;
  return (
    <div className="flex min-h-48 flex-1 items-end gap-1 sm:gap-2" role="img" aria-label="Épargne versée et prévue par mois (détail dans le tableau de suivi)">
      {series.map((s) => (
        <div key={s.month} className="flex h-full min-w-0 flex-1 flex-col items-center gap-1" title={`${monthLabel(s.month)} · versé ${money(s.actual)} · prévu ${money(s.planned)}`}>
          <div className="relative w-full flex-1">
            {s.planned > 0 && <div className="absolute inset-x-0 bottom-0 rounded-t-[var(--r-xs)] border border-dashed border-accent" style={{ height: h(s.planned) }} />}
            <div className="absolute inset-x-1 bottom-0 rounded-t-[var(--r-xs)] bg-accent" style={{ height: h(s.actual) }} />
          </div>
          <span className="text-micro text-faint">{shortMonth(s.month)}</span>
        </div>
      ))}
    </div>
  );
}

/** Courbe du cumul ; étirée à la largeur (trait non déformé). */
function CumulativeLine({ series }: { series: SavingsMonth[] }) {
  const max = Math.max(1, ...series.map((s) => s.cumulative)), n = series.length;
  const pts = series.map((s, i) => `${n === 1 ? 50 : (i / (n - 1)) * 100},${100 - (s.cumulative / max) * 95}`);
  return (
    <>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-40 w-full" role="img" aria-label="Épargne cumulée sur 12 mois (détail dans le tableau de suivi)">
        <polygon points={`0,100 ${pts.join(" ")} 100,100`} fill="var(--chart-1)" opacity={0.12} />
        <polyline points={pts.join(" ")} fill="none" stroke="var(--chart-1)" strokeWidth={2.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      <div className="flex justify-between text-label text-faint"><span>{monthLabel(series[0].month)}</span><span>{monthLabel(series[n - 1].month)}</span></div>
    </>
  );
}

/** Épargne : versements (dépenses de la catégorie d'épargne, déduites des revenus) et suivi des 12 derniers mois. */
export default async function SavingsPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const user = await requireUser();
  const todayStr = todayIn(user.household.timezone);
  const month = parseMonth((await searchParams).m) ?? parseMonth(todayStr.slice(0, 7))!;
  const [{ series, recent }, members] = await Promise.all([getSavings(user.householdId, month), payers(user.householdId)]);
  const money = (cents: number) => formatCents(cents, user.household.currency);
  const cur = series[series.length - 1];
  const average = Math.round(series.reduce((s, m) => s + m.actual, 0) / series.length);
  const left = Math.max(cur.planned - cur.actual, 0);
  // Date proposée : aujourd'hui pour le mois en cours, sinon le 1er du mois affiché.
  const day = formatMonth(month) === todayStr.slice(0, 7) ? todayStr : `${formatMonth(month)}-01`;

  return (
    <>
      <PageHeader
        eyebrow="Foyra / Épargne"
        title="Épargne"
        subtitle={`Versements mis de côté, déduits des revenus comme une charge · ${monthLabel(cur.month)}.`}
        actions={
          <>
            <MonthNav path="/epargne" month={month} />
            <a href="#mettre-de-cote" className="button"><Icon name="plus" className="size-4" />Mettre de côté</a>
          </>
        }
      />

      <div className="dash-kpis">
        <Card variant="hero" className="kpi-card">
          <div className="kpi-top">
            <span className="kpi-icon hero"><Icon name="savings" className="size-4" /></span>
            <span className="kpi-title">Épargné ce mois</span>
          </div>
          <strong className="kpi-value">{money(cur.actual)}</strong>
          {cur.planned > 0 ? (
            <>
              <ProgressBar value={cur.actual} max={cur.planned} label="Épargne versée par rapport au prévu" />
              <span className="kpi-note">{Math.round((cur.actual / cur.planned) * 100)} % du prévu ({money(cur.planned)})</span>
            </>
          ) : (
            <span className="kpi-note">Aucune ligne « Épargne » au budget de ce mois.</span>
          )}
        </Card>
        <Stat label="Prévu ce mois" value={money(cur.planned)} note={cur.planned ? `Reste à verser ${money(left)}` : "Aucune ligne « Épargne » au budget"} />
        <Stat label="Total épargné" value={money(cur.cumulative)} tone="pos" note="Cumul de tous les versements" />
        <Stat label="Moyenne mensuelle" value={money(average)} note="Sur les 12 derniers mois" />
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-7">
          <SectionHeader
            title="Versé et prévu par mois"
            subtitle="12 derniers mois"
            action={
              <span className="ab-legend mt-0">
                <span><i className="bg-accent" />Versé</span>
                <span><i className="border border-dashed border-accent" />Prévu au budget</span>
              </span>
            }
          />
          <MonthBars series={series} money={money} />
        </Card>

        <Card className="lg:col-span-5" id="mettre-de-cote">
          <SectionHeader title="Mettre de côté" subtitle="Enregistré comme dépense « Épargne » (charge fixe) : déduit des revenus du mois." />
          <ActionForm action={addSavingAction}>
            <input type="hidden" name="idempotencyKey" value={crypto.randomUUID()} />
            <Field name="amount" label="Montant à épargner"><input name="amount" inputMode="decimal" required placeholder="0,00" autoComplete="off" /></Field>
            <Field name="occurredOn" label="Date"><input name="occurredOn" type="date" required defaultValue={day} /></Field>
            <Field name="note" label="Note (facultatif)"><input name="note" maxLength={500} placeholder="Livret A, projet vacances…" /></Field>
            <Field name="paidById" label="Versé par">
              <select name="paidById" defaultValue={user.id}>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </Field>
            <SharedCheck label="Commune (partagée au prorata des revenus)" checked />
            <button type="submit">Mettre de côté</button>
          </ActionForm>
        </Card>

        <Card className="lg:col-span-12">
          <SectionHeader title="Évolution de l’épargne cumulée" action={<b className="ab-num text-section text-heading">{money(cur.cumulative)}</b>} />
          <CumulativeLine series={series} />
        </Card>

        <Card variant="table" className="lg:col-span-7">
          <SectionHeader title="Suivi mensuel" subtitle="Prévu au budget contre versé" />
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Mois</th>
                  <th className="num">Prévu</th>
                  <th className="num">Versé</th>
                  <th className="num hidden sm:table-cell">Écart</th>
                  <th className="num">Cumul</th>
                </tr>
              </thead>
              <tbody>
                {[...series].reverse().map((s) => {
                  const gap = s.actual - s.planned;
                  return (
                    <tr key={s.month}>
                      <td className="whitespace-nowrap"><Link href={`/epargne?m=${s.month}`} aria-current={s.month === cur.month ? "page" : undefined}>{monthLabel(s.month)}</Link></td>
                      <td className="num text-muted">{s.planned ? money(s.planned) : "—"}</td>
                      <td className="num font-bold text-heading">{money(s.actual)}</td>
                      <td className={`num hidden sm:table-cell ${gap < 0 ? "text-neg" : "text-pos"}`}>{s.planned ? money(gap) : "—"}</td>
                      <td className="num">{money(s.cumulative)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="lg:col-span-5">
          <SectionHeader title="Historique des versements" subtitle="10 derniers versements" />
          {recent.length === 0 ? (
            <EmptyState title="Aucun versement" action={<a href="#mettre-de-cote">Mettre de côté</a>}>Les montants mis de côté apparaîtront ici.</EmptyState>
          ) : (
            <ul className="due-list">
              {recent.map((t) => (
                <li key={t.id}>
                  <Link href={`/operations/${t.id}`}>
                    <DateTile date={t.occurredOn} />
                    <span className="min-w-0 flex-1">
                      <b className="block truncate text-heading">{t.note || "Épargne"}</b>
                      <small className="block truncate text-label text-faint">{formatDay(t.occurredOn).split("-").reverse().join("/")} · {t.paidBy.name}</small>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <b className="ab-num text-heading">{money(t.amount)}</b>
                      <Badge dot tone={t.shared ? "success" : "muted"}>{t.shared ? "Commune" : "Perso"}</Badge>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
