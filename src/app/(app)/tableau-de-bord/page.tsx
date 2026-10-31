import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listCategories } from "@/lib/categories";
import { addMonths } from "@/lib/amortization";
import { envelopes, formatMonth, getBudget, parseMonth } from "@/lib/budget";
import { getDashboard, getDashboardCharts } from "@/lib/dashboard";
import { parseDay, payers, todayIn } from "@/lib/ledger";
import { configuredProviders } from "@/lib/llm";
import { formatCents } from "@/lib/money";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { analyzeAction } from "@/app/actions";
import { ActionForm } from "@/app/form";
import { EntryForm } from "../operations/entry-form";
import { AnalyticsBento, KpiCards, SpendingByCategory, type Kpi } from "./charts";

const monthLabel = (month: Date) => new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(month);

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const user = await requireUser();
  const todayStr = todayIn(user.household.timezone);
  const today = parseDay(todayStr)!;
  const month = parseMonth((await searchParams).m) ?? parseMonth(todayStr.slice(0, 7))!;
  // Graphiques arrêtés au dernier jour du mois affiché, jamais au-delà d'aujourd'hui, ni avant le 1er du mois affiché (mois futur).
  const asOf = new Date(Math.max(month.getTime(), Math.min(today.getTime(), addMonths(month, 1).getTime() - 86_400_000)));
  const [d, categories, members] = await Promise.all([getDashboard(user.householdId, today, month), listCategories(user.householdId), payers(user.householdId)]);
  const money = (cents: number) => formatCents(cents, user.household.currency);
  const [charts, budget] = await Promise.all([
    // Graphiques seulement s'il existe des opérations réelles : jamais de courbe inventée.
    d.recent.length ? getDashboardCharts(user.householdId, asOf) : null,
    d.budget ? getBudget(user.householdId, d.month) : null,
  ]);
  const { lines, reserve } = budget ? envelopes(budget.tree) : { lines: [], reserve: null };
  const env = [...lines, ...(reserve ? [reserve] : [])];
  const spent = charts && charts.categories.periods[0].total > 0;
  // Courbes : cumul jour par jour depuis 0 jusqu'à asOf (toujours ≥ 2 points), comparé au même jour du mois précédent.
  const day = asOf.getUTCDate();
  const flow = (a: number[][] | undefined) => ({ series: a ? [0, ...a[0].slice(0, day)] : null, prev: a?.[1][day - 1] ?? null });
  const netFlow = charts && charts.flows.income.map((r, k) => r.map((v, i) => v - charts.flows.expense[k][i]));
  const kpis: Kpi[] = [
    { label: "Revenus du mois", value: d.income, note: d.budget ? "Saisis dans le budget du mois" : "Aucun budget ce mois-ci", colors: ["#22d3ee", "#3bf08c"], ...flow(charts?.flows.income) },
    { label: "Dépenses du mois", value: d.expense, note: "Opérations enregistrées", upIsGood: false, colors: ["#ffb800", "#ff3da5"], ...flow(charts?.flows.expense) },
    { label: "Reste réel", value: d.net, note: "Recettes − dépenses enregistrées", colors: ["#22d3ee", "#818cf8"], ...flow(netFlow ?? undefined) },
  ];

  return (
    <>
      <nav className="pager" aria-label="Mois">
        <Link href={`/tableau-de-bord?m=${formatMonth(addMonths(month, -1))}`}>← Mois précédent</Link>
        <h1>Tableau de bord · {monthLabel(d.month)}</h1>
        <Link href={`/tableau-de-bord?m=${formatMonth(addMonths(month, 1))}`}>Mois suivant →</Link>
      </nav>
      {formatMonth(month) !== todayStr.slice(0, 7) && <p className="mb-4 text-center"><Link href="/tableau-de-bord">Revenir au mois en cours</Link></p>}
      {configuredProviders(user.household).length > 0 && (
        <ActionForm action={analyzeAction} className="form mb-4">
          <button type="submit">Analyser</button>
        </ActionForm>
      )}

      <KpiCards currency={user.household.currency} items={kpis} />

      <div className="mt-4">
        <Card>
          <CardHeader>
            <CardTitle>Enveloppes</CardTitle>
            <Link href={`/budget?m=${formatMonth(month)}`} className="text-sm">Voir le budget</Link>
          </CardHeader>
          {env.length === 0 ? (
            <EmptyState title="Aucune enveloppe ce mois-ci">Les enveloppes communes du budget apparaîtront ici.</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm tabular-nums">
                <thead>
                  <tr className="text-left text-muted">
                    <th className="py-2 pr-3 font-medium">Libellé</th>
                    <th className="py-2 pr-3 text-right font-medium">Prévu</th>
                    <th className="py-2 pr-3 text-right font-medium">Réel</th>
                    <th className="py-2 text-right font-medium">Restant</th>
                  </tr>
                </thead>
                <tbody>
                  {env.map((e) => (
                    <tr key={e.id} className="border-t border-hairline">
                      <td className="py-2 pr-3 break-words">
                        {e.label}
                        {e === reserve && <small className="block text-xs text-muted">Réserve · dont {money(reserve.overrun)} de dépassements absorbés</small>}
                      </td>
                      <td className="py-2 pr-3 text-right whitespace-nowrap">{money(e.planned)}</td>
                      <td className="py-2 pr-3 text-right whitespace-nowrap">{money(e.actual)}</td>
                      <td className={`py-2 text-right whitespace-nowrap ${e.left < 0 ? "text-neg" : "text-heading"}`}>{money(e.left)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {charts && (
        <div className="mt-4">
          <AnalyticsBento
            currency={user.household.currency}
            data={charts}
            aside={spent && <Card className="w6"><SpendingByCategory currency={user.household.currency} data={charts.categories} /></Card>}
          />
        </div>
      )}

      <details>
        <summary>Saisie rapide d’une opération</summary>
        {/* Clé = dernière opération : une saisie réussie change la clé, le formulaire repart vide. */}
        <EntryForm key={d.recent[0]?.id} back="dashboard" members={members} categories={categories} v={{ occurredOn: todayStr, paidById: user.id }} />
      </details>
    </>
  );
}
