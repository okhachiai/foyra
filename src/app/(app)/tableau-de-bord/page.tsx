import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listCategories } from "@/lib/categories";
import { addMonths } from "@/lib/amortization";
import { actualTotals, envelopes, formatMonth, getBudget, parseMonth, uncoveredFixedLines } from "@/lib/budget";
import { listMonthCharges } from "@/lib/charges";
import { getSplit } from "@/lib/split";
import { getDashboard, getDashboardCharts } from "@/lib/dashboard";
import { formatDay, parseDay, payers, todayIn } from "@/lib/ledger";
import { configuredProviders } from "@/lib/llm";
import { formatCents } from "@/lib/money";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Stat } from "@/components/ui/stat";
import { analyzeAction } from "@/app/actions";
import { ActionForm } from "@/app/form";
import { EntryForm } from "../operations/entry-form";
import { Fold } from "../budget/fold";
import { AnalyticsBento, KpiCards, SpendingByCategory, type Kpi } from "./charts";

const percent = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 2 });
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
  const [charts, budget, charges, actual, split] = await Promise.all([
    // Graphiques seulement s'il existe des opérations réelles : jamais de courbe inventée.
    d.recent.length ? getDashboardCharts(user.householdId, asOf) : null,
    d.budget ? getBudget(user.householdId, d.month) : null,
    listMonthCharges(user.householdId, d.month),
    actualTotals(user.householdId, d.month),
    // Partage : utile à partir de deux membres.
    getSplit(user.householdId, d.month).then((s) => (s.members.length > 1 ? s : null)),
  ]);
  const { lines, reserve } = budget ? envelopes(budget.tree) : { lines: [], reserve: null };
  const env = [...lines, ...(reserve ? [reserve] : [])];
  // Charges fixes et crédits du mois, calculés en direct : un crédit soldé n'apparaît plus.
  const expenses = charges.filter((c) => c.kind === "EXPENSE");
  const fixed = expenses.filter((c) => !c.loanId), loans = expenses.filter((c) => c.loanId);
  const sum = (l: typeof expenses) => l.reduce((s, c) => s + c.amount, 0);
  // Lignes fixes du budget sans charge récurrente : listées aussi, sans jour d'échéance.
  const planned = budget ? uncoveredFixedLines(budget.tree, new Set(charges.map((c) => c.categoryId))) : [];
  const fixedTotal = sum(fixed) + planned.reduce((s, l) => s + l.amount, 0), loanTotal = sum(loans);
  const spent = charts && charts.categories.periods[0].total > 0;
  // Courbes : cumul jour par jour depuis 0 jusqu'à asOf (toujours ≥ 2 points), comparé au même jour du mois précédent.
  const day = asOf.getUTCDate();
  const flow = (a: number[][] | undefined) => ({ series: a ? [0, ...a[0].slice(0, day)] : null, prev: a?.[1][day - 1] ?? null });
  const netFlow = charts && charts.flows.income.map((r, k) => r.map((v, i) => v - charts.flows.expense[k][i]));
  const kpis: Kpi[] = [
    { label: "Revenus du mois", icon: "wallet", value: d.income, note: d.budget ? "Saisis dans le budget du mois" : "Aucun budget ce mois-ci", colors: ["#8fb8a5", "#336956"], ...flow(charts?.flows.income) },
    { label: "Dépenses du mois", icon: "receipt", value: d.expense, note: "Opérations enregistrées", upIsGood: false, colors: ["#e2ad97", "#cc7c5e"], ...flow(charts?.flows.expense) },
    { label: "Reste réel", icon: "trend", value: d.net, note: "Recettes − dépenses enregistrées", colors: ["#8fb8a5", "#336956"], ...flow(netFlow ?? undefined) },
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

      {budget && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Stat label="Total des revenus" value={money(budget.totals.income)} note={`Réel ${money(actual.income)}`} />
          <Stat label="Charges fixes" value={money(budget.totals.fixed)} note={`Réel ${money(actual.fixed)}`} />
          <Stat label="Charges variables" value={money(budget.totals.variable)} note={`Réel ${money(actual.variable)}`} />
          <Stat label="Épargne" value={money(budget.totals.savings)} note={`Prévu, ou versé s’il est plus élevé · réel ${money(actual.savings)}`} />
          <Stat label="Reste prévisionnel" value={money(budget.totals.remaining)} tone={budget.totals.remaining < 0 ? "neg" : undefined} note="Revenus − fixes − variables − épargne" />
          <Stat label="Reste réel (budget)" value={money(actual.remaining)} tone={actual.remaining < 0 ? "neg" : undefined} note="Mêmes calculs sur les opérations enregistrées du mois" />
        </div>
      )}

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

      {split && (
        <Fold className="mt-4" title="Partage" aside={<span className="amount" title="Dépenses communes prévues, moins les recettes communes">{money(split.commonNet)}</span>}>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm tabular-nums">
              <thead>
                <tr className="text-left text-muted">
                  <th className="py-2 pr-3 font-medium">Membre</th>
                  <th className="py-2 pr-3 text-right font-medium">Revenu</th>
                  <th className="py-2 pr-3 text-right font-medium">Part</th>
                  <th className="py-2 pr-3 text-right font-medium">Dû</th>
                  <th className="py-2 pr-3 text-right font-medium">Communes payées</th>
                  <th className="py-2 pr-3 text-right font-medium">Reste à verser</th>
                  <th className="py-2 text-right font-medium">Reste perso</th>
                </tr>
              </thead>
              <tbody>
                {split.members.map((m) => (
                  <tr key={m.userId} className="border-t border-hairline">
                    <td className="py-2 pr-3">{m.name}</td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap">{money(m.income)}</td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap">{percent.format(m.shareBp / 10000)}</td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap">{money(m.due)}</td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap">{money(m.contribution)}</td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap text-heading">
                      {m.toTransfer < 0 ? <>à recevoir {money(-m.toTransfer)}</> : money(m.toTransfer)}
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">{money(m.personalLeft)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Fold>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Fold title="Échéances du mois" aside={<span className="amount">{money(fixedTotal)}</span>}>
          {fixed.length === 0 && planned.length === 0 && <p className="m-0 text-sm text-muted">Aucune charge fixe ce mois-ci.</p>}
          {fixed.map((c) => (
            <Link key={c.id} href={`/charges/${c.id}`} className="flex justify-between gap-3 border-t border-hairline py-2">
              <span>{c.name} <small className="text-muted">· le {c.due.getUTCDate()}{!c.budgeted && " · absente du budget"}</small></span>
              <span className="amount">{money(c.amount)}</span>
            </Link>
          ))}
          {planned.map((l) => (
            <div key={l.id} className="flex justify-between gap-3 border-t border-hairline py-2">
              <span>{l.label} <small className="text-muted">· prévu au budget</small></span>
              <span className="amount">{money(l.amount)}</span>
            </div>
          ))}
        </Fold>
        <Fold title="Crédits en cours" aside={<span className="amount">{money(loanTotal)}</span>}>
          {loans.length === 0 && <p className="m-0 text-sm text-muted">Aucun crédit en cours ce mois-ci.</p>}
          {loans.map((c) => (
            <Link key={c.id} href={`/credits/${c.loanId}`} className="flex justify-between gap-3 border-t border-hairline py-2">
              <span>
                {c.name}
                {c.installment && (
                  <small className="block text-muted">
                    1ʳᵉ échéance {formatDay(c.installment.firstDue).split("-").reverse().join("/")} · échéance {c.installment.n}/{c.installment.of}
                    {c.installment.n === c.installment.of && " · dernière"}
                  </small>
                )}
              </span>
              <span className="amount">{money(c.amount)}</span>
            </Link>
          ))}
        </Fold>
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
