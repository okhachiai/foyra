import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { addMonths } from "@/lib/amortization";
import { formatMonth, parseMonth } from "@/lib/budget";
import { formatDay, payers, todayIn } from "@/lib/ledger";
import { formatCents } from "@/lib/money";
import { getSavings, type SavingsMonth } from "@/lib/savings";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Stat } from "@/components/ui/stat";
import { addSavingAction } from "@/app/actions";
import { ActionForm, Field, SharedCheck } from "@/app/form";

const fr = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("fr-FR", { ...opts, timeZone: "UTC" });
const monthLabel = (key: string) => fr({ month: "long", year: "numeric" }).format(new Date(`${key}-01T00:00:00Z`));
const shortMonth = (key: string) => fr({ month: "short" }).format(new Date(`${key}-01T00:00:00Z`));
const frDay = (d: Date) => formatDay(d).split("-").reverse().join("/");

/** Barres mensuelles : versé (plein) devant le prévu (contour). HTML/CSS, lisible à toute largeur. */
function MonthBars({ series, money }: { series: SavingsMonth[]; money: (c: number) => string }) {
  const max = Math.max(1, ...series.flatMap((s) => [s.actual, s.planned]));
  const h = (v: number) => `${(v / max) * 100}%`;
  return (
    <div className="flex h-48 items-end gap-1 sm:gap-2" role="img" aria-label="Épargne versée et prévue par mois">
      {series.map((s) => (
        <div key={s.month} className="flex h-full min-w-0 flex-1 flex-col items-center gap-1" title={`${monthLabel(s.month)} · versé ${money(s.actual)} · prévu ${money(s.planned)}`}>
          <div className="relative w-full flex-1">
            {s.planned > 0 && <div className="absolute inset-x-0 bottom-0 rounded-t border border-dashed border-accent/70" style={{ height: h(s.planned) }} />}
            <div className="absolute inset-x-1 bottom-0 rounded-t bg-pos/80" style={{ height: h(s.actual) }} />
          </div>
          <span className="text-[10px] text-muted sm:text-xs">{shortMonth(s.month)}</span>
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
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-40 w-full" role="img" aria-label="Épargne cumulée">
        <polygon points={`0,100 ${pts.join(" ")} 100,100`} fill="var(--pos)" opacity={0.12} />
        <polyline points={pts.join(" ")} fill="none" stroke="var(--pos)" strokeWidth={2.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      <div className="flex justify-between text-xs text-muted"><span>{monthLabel(series[0].month)}</span><span>{monthLabel(series[n - 1].month)}</span></div>
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
  // Date proposée : aujourd'hui pour le mois en cours, sinon le 1er du mois affiché.
  const day = formatMonth(month) === todayStr.slice(0, 7) ? todayStr : `${formatMonth(month)}-01`;

  return (
    <>
      <nav className="pager" aria-label="Mois">
        <Link href={`/epargne?m=${formatMonth(addMonths(month, -1))}`}>← Mois précédent</Link>
        <h1>Épargne · {monthLabel(cur.month)}</h1>
        <Link href={`/epargne?m=${formatMonth(addMonths(month, 1))}`}>Mois suivant →</Link>
      </nav>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Épargné ce mois" value={money(cur.actual)} tone="pos" note="Déduit des revenus comme une charge" />
        <Stat label="Prévu ce mois" value={money(cur.planned)} note={cur.planned ? `Reste à verser ${money(Math.max(cur.planned - cur.actual, 0))}` : "Aucune ligne « Épargne » au budget"} />
        <Stat label="Total épargné" value={money(cur.cumulative)} note="Cumul de tous les versements" />
        <Stat label="Moyenne mensuelle" value={money(average)} note="Sur les 12 derniers mois" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-5">
          <CardHeader><CardTitle>Mettre de côté</CardTitle></CardHeader>
          <CardDescription>Enregistré comme dépense « Épargne » (charge fixe) : déduit des revenus du mois.</CardDescription>
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
            <button type="submit">Épargner</button>
          </ActionForm>
        </Card>

        <Card className="lg:col-span-7">
          <CardHeader>
            <CardTitle>Par mois</CardTitle>
            <span className="flex gap-3 text-xs text-muted">
              <span><i className="mr-1 inline-block size-2.5 rounded-sm bg-pos/80" />Versé</span>
              <span><i className="mr-1 inline-block size-2.5 rounded-sm border border-dashed border-accent/70" />Prévu au budget</span>
            </span>
          </CardHeader>
          <MonthBars series={series} money={money} />
        </Card>

        <Card className="lg:col-span-12">
          <CardHeader>
            <CardTitle>Épargne cumulée</CardTitle>
            <span className="amount">{money(cur.cumulative)}</span>
          </CardHeader>
          <CumulativeLine series={series} />
        </Card>

        <Card className="lg:col-span-7">
          <CardHeader><CardTitle>Suivi mensuel</CardTitle></CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm tabular-nums">
              <thead>
                <tr className="text-left text-muted">
                  <th className="py-2 pr-3 font-medium">Mois</th>
                  <th className="py-2 pr-3 text-right font-medium">Prévu</th>
                  <th className="py-2 pr-3 text-right font-medium">Versé</th>
                  <th className="hidden py-2 pr-3 text-right font-medium sm:table-cell">Écart</th>
                  <th className="py-2 text-right font-medium">Cumul</th>
                </tr>
              </thead>
              <tbody>
                {[...series].reverse().map((s) => {
                  const gap = s.actual - s.planned;
                  return (
                    <tr key={s.month} className="border-t border-hairline">
                      <td className="py-2 pr-3 whitespace-nowrap"><Link href={`/epargne?m=${s.month}`}>{monthLabel(s.month)}</Link></td>
                      <td className="py-2 pr-3 text-right text-muted">{s.planned ? money(s.planned) : "—"}</td>
                      <td className="py-2 pr-3 text-right text-heading">{money(s.actual)}</td>
                      <td className={`hidden py-2 pr-3 text-right sm:table-cell ${gap < 0 ? "text-neg" : "text-pos"}`}>{s.planned ? money(gap) : "—"}</td>
                      <td className="py-2 text-right">{money(s.cumulative)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="lg:col-span-5">
          <CardHeader><CardTitle>Derniers versements</CardTitle></CardHeader>
          {recent.length === 0 ? (
            <EmptyState title="Aucun versement">Les montants mis de côté apparaîtront ici.</EmptyState>
          ) : (
            <ul className="m-0 flex list-none flex-col p-0">
              {recent.map((t) => (
                <li key={t.id} className="border-t border-hairline first:border-t-0">
                  <Link href={`/operations/${t.id}`} className="flex items-center justify-between gap-4 py-2.5 text-inherit no-underline hover:text-heading">
                    <span className="min-w-0">{t.note || "Épargne"}<small className="block text-xs text-muted">{frDay(t.occurredOn)} · {t.paidBy.name}</small></span>
                    <span className="amount">{money(t.amount)}</span>
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
