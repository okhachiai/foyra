import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listCategories } from "@/lib/categories";
import { addMonths } from "@/lib/amortization";
import { actualTotals, envelopes, formatMonth, getBudget, parseMonth, uncoveredFixedLines } from "@/lib/budget";
import { listMonthCharges } from "@/lib/charges";
import { getSplit } from "@/lib/split";
import { getDashboard, getDashboardCharts, spendingPlan, upcomingCharges } from "@/lib/dashboard";
import { formatDay, parseDay, payers, todayIn } from "@/lib/ledger";
import { configuredProviders } from "@/lib/llm";
import { formatCents } from "@/lib/money";
import { getSavings } from "@/lib/savings";
import { Badge } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { MonthNav } from "@/components/ui/month-nav";
import { PageHeader } from "@/components/ui/page-header";
import { ProgressBar } from "@/components/ui/progress";
import { analyzeAction } from "@/app/actions";
import { ActionForm } from "@/app/form";
import { EntryForm } from "../operations/entry-form";
import { Fold } from "../budget/fold";
import { AnalyticsBento, CashFlow, KpiRow, SpendingByCategory, type Kpi } from "./charts";

const percent = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 2 });
const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("fr-FR", { ...opts, timeZone: "UTC" });
const monthLabel = (month: Date) => fmt({ month: "long", year: "numeric" }).format(month);
const shortDate = (d: Date) => fmt({ day: "numeric", month: "short" }).format(d);
const STATUS = { paid: ["success", "Payée"], due: ["warning", "À venir"], late: ["danger", "En retard"] } as const;

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const user = await requireUser();
  const todayStr = todayIn(user.household.timezone);
  const today = parseDay(todayStr)!;
  const month = parseMonth((await searchParams).m) ?? parseMonth(todayStr.slice(0, 7))!;
  // Graphiques arrêtés au dernier jour du mois affiché, jamais au-delà d'aujourd'hui, ni avant le 1er du mois affiché (mois futur).
  const asOf = new Date(Math.max(month.getTime(), Math.min(today.getTime(), addMonths(month, 1).getTime() - 86_400_000)));
  const [d, categories, members] = await Promise.all([getDashboard(user.householdId, today, month), listCategories(user.householdId), payers(user.householdId)]);
  const currency = user.household.currency;
  const money = (cents: number) => formatCents(cents, currency);
  const whole = new Intl.NumberFormat("fr-FR", { style: "currency", currency, maximumFractionDigits: 0 });
  const round = (cents: number) => whole.format(cents / 100);
  const [charts, budget, charges, actual, split, savings] = await Promise.all([
    // Graphiques seulement s'il existe des opérations réelles : jamais de courbe inventée.
    d.recent.length ? getDashboardCharts(user.householdId, asOf) : null,
    d.budget ? getBudget(user.householdId, d.month) : null,
    listMonthCharges(user.householdId, d.month),
    actualTotals(user.householdId, d.month),
    // Partage : utile à partir de deux membres.
    getSplit(user.householdId, d.month).then((s) => (s.members.length > 1 ? s : null)),
    getSavings(user.householdId, d.month, 3),
  ]);
  const { lines, reserve } = budget ? envelopes(budget.tree) : { lines: [], reserve: null };
  const env = [...lines, ...(reserve ? [reserve] : [])];
  const plan = budget && spendingPlan(budget.tree);
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
  const savingsPlanned = d.budget?.totals.savings ?? 0;
  const used = plan && plan.planned ? Math.round((plan.actual / plan.planned) * 100) : null;
  const kpis: Kpi[] = [
    {
      // Même calcul que le « reste réel » du budget : opérations du mois uniquement, jamais un solde bancaire.
      label: "Reste disponible", icon: "wallet", tone: "hero", value: d.net, prev: null, colors: ["var(--hero-muted)", "var(--hero-text)"],
      series: flow(netFlow ?? undefined).series,
      note: "Revenus encaissés − dépenses et épargne enregistrées ce mois-ci. Ce n’est pas un solde bancaire.",
    },
    { label: "Revenus du mois", icon: "arrowIn", tone: "accent", value: d.income, note: d.budget ? "Saisis dans le budget du mois" : "Aucun budget ce mois-ci", colors: ["var(--chart-1-soft)", "var(--chart-1)"], ...flow(charts?.flows.income) },
    {
      label: "Dépenses du mois", icon: "arrowOut", tone: "expense", value: d.expense, upIsGood: false, colors: ["var(--chart-2-soft)", "var(--chart-2)"], ...flow(charts?.flows.expense),
      note: used !== null && plan ? `${used} % du budget de dépenses (${round(plan.planned)})` : "Opérations enregistrées, sans budget de dépenses",
    },
    {
      label: "Épargne du mois", icon: "target", tone: "info", value: actual.savings, series: null, prev: null, colors: ["var(--chart-4)", "var(--chart-4)"],
      note: savingsPlanned ? `${Math.round((actual.savings / savingsPlanned) * 100)} % des ${round(savingsPlanned)} prévus au budget` : "Versements du mois, rien de prévu au budget",
      progress: savingsPlanned ? { value: actual.savings, max: savingsPlanned, label: "Épargne versée sur le prévu" } : undefined,
    },
  ];
  const current = formatMonth(month) === todayStr.slice(0, 7);
  const due = upcomingCharges(charges, today);
  const recentSavings = [...savings.series].reverse();
  // Phrase de situation : uniquement des chiffres calculés ci-dessus.
  const situation = [
    `${monthLabel(d.month).replace(/^./, (c) => c.toUpperCase())} : ${round(d.expense)} de dépenses enregistrées`,
    d.budget && `reste prévisionnel ${round(d.budget.totals.remaining)}`,
    d.unpaid.length > 0 && `${d.unpaid.length} échéance${d.unpaid.length > 1 ? "s" : ""} à payer${d.late.count ? `, dont ${d.late.count} en retard` : ""}`,
  ].filter(Boolean).join(" · ");
  const budgetHref = `/budget?m=${formatMonth(month)}`;

  return (
    <>
      <PageHeader
        eyebrow="Foyra / Vue d’ensemble"
        title="Votre argent, en toute clarté."
        subtitle={<>{situation}.{!current && <> <Link href="/tableau-de-bord">Revenir au mois en cours</Link></>}</>}
        actions={
          <>
            {configuredProviders(user.household).length > 0 && (
              <ActionForm action={analyzeAction} className="inline">
                <button type="submit" className="ghost"><Icon name="reports" className="size-4" />Analyse IA</button>
              </ActionForm>
            )}
            <a href={`/budget/export?m=${formatMonth(month)}`} className="button ghost"><Icon name="download" className="size-4" />Exporter</a>
            <MonthNav path="/tableau-de-bord" month={month} />
            <Link href="/operations/new?back=dashboard" className="button"><Icon name="plus" className="size-4" />Ajouter une opération</Link>
          </>
        }
      />

      <KpiRow currency={currency} items={kpis} />

      <div className="dash-analysis">
        <Card className="w-cash">
          <SectionHeader title="Flux financiers" subtitle="Revenus, dépenses et résultat mensuel (opérations enregistrées)" />
          {charts ? <CashFlow currency={currency} data={charts.monthly} /> : <EmptyState title="Aucune opération enregistrée">Les barres apparaîtront avec les premières opérations.</EmptyState>}
        </Card>

        <Card>
          <SectionHeader
            title="Budget de dépenses"
            subtitle={`Réel / prévu · ${monthLabel(d.month)}`}
            action={used !== null && <Badge tone={used > 100 ? "danger" : used > 90 ? "warning" : "success"}>{used} %</Badge>}
          />
          {plan && plan.lines.length > 0 ? (
            <>
              <ul className="plan-list">
                {plan.lines.slice(0, 5).map((l) => (
                  <li key={l.id}>
                    <div className="plan-row"><b>{l.label}</b><span className="ab-num">{round(l.actual)} / {round(l.planned)}</span></div>
                    <ProgressBar value={l.actual} max={l.planned} label={`${l.label} : part du prévu dépensée`} />
                    <small className={l.left < 0 ? "text-neg font-semibold" : undefined}>{l.left < 0 ? `Dépassé de ${round(-l.left)}` : `${round(l.left)} restant`}</small>
                  </li>
                ))}
              </ul>
              <div className="card-foot">
                <span className="text-label text-muted">Restant <b className={`ab-num ${plan.left < 0 ? "text-neg" : "text-heading"}`}>{round(plan.left)}</b></span>
                <Link href={budgetHref} className="tap-link text-label font-bold">{plan.lines.length > 5 ? `Budget complet (+${plan.lines.length - 5})` : "Budget complet"}</Link>
              </div>
            </>
          ) : (
            <EmptyState title="Aucun budget de dépenses" action={<Link href={budgetHref}>Préparer le budget</Link>}>
              Les lignes de dépense du budget apparaîtront ici, avec leur réel.
            </EmptyState>
          )}
        </Card>

        <Card>
          <SectionHeader
            title="Épargne"
            subtitle="Versé sur prévu, 3 derniers mois"
            action={<Link href="/epargne" className="icon-link" aria-label="Mettre de côté"><Icon name="plus" className="size-4" /></Link>}
          />
          {recentSavings.some((m) => m.planned || m.actual) ? (
            <>
              <ul className="plan-list">
                {recentSavings.map((m) => {
                  const ratio = m.planned ? Math.round((m.actual / m.planned) * 100) : null;
                  return (
                    <li key={m.month}>
                      <div className="plan-row">
                        <b className="first-letter:uppercase">{monthLabel(parseMonth(m.month)!)}</b>
                        <span className="ab-num font-bold text-accent-ink">{ratio === null ? "—" : `${ratio} %`}</span>
                      </div>
                      <ProgressBar value={m.actual} max={Math.max(m.planned, m.actual)} tone="info" label={`Épargne de ${m.month} : versé sur prévu`} />
                      <small>{round(m.actual)} versés{m.planned ? ` sur ${round(m.planned)}` : ", rien de prévu"}</small>
                    </li>
                  );
                })}
              </ul>
              <div className="card-foot">
                <span className="text-label text-muted">Total épargné</span>
                <b className="ab-num">{money(savings.series.at(-1)!.cumulative)}</b>
              </div>
            </>
          ) : (
            <EmptyState title="Aucune épargne ces trois derniers mois" action={<Link href="/epargne">Mettre de côté</Link>} />
          )}
        </Card>
      </div>

      <div className="dash-activity">
        <Card variant="table">
          <SectionHeader title="Dernières opérations" subtitle={`Jusqu’à fin ${monthLabel(d.month)}`} action={<Link href="/operations" className="tap-link text-label font-bold">Voir tout</Link>} />
          {d.recent.length === 0 ? (
            <EmptyState title="Aucune opération" action={<Link href="/operations/new?back=dashboard">Ajouter une opération</Link>} />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>Opération</th><th className="hidden sm:table-cell">Payé par</th><th className="hidden sm:table-cell">Statut</th><th className="num">Montant</th></tr>
                </thead>
                <tbody>
                  {d.recent.map((t) => {
                    const cat = t.category ? (t.category.parent ? `${t.category.parent.name} › ${t.category.name}` : t.category.name) : null;
                    const income = t.kind === "INCOME";
                    return (
                      <tr key={t.id}>
                        <td className="w-full max-w-0">
                          <div className="flex items-center gap-3">
                            <span className={`row-icon ${income ? "accent" : "expense"}`}><Icon name={income ? "arrowIn" : "arrowOut"} className="size-4" /></span>
                            <span className="min-w-0">
                              <Link href={`/operations/${t.id}`} className="block truncate text-heading no-underline hover:underline">{cat ?? t.note ?? (income ? "Recette" : "Dépense")}</Link>
                              <small className="block truncate text-label font-medium text-faint">{shortDate(t.occurredOn)}{cat && t.note ? ` · ${t.note}` : ""}</small>
                            </span>
                          </div>
                        </td>
                        <td className="hidden sm:table-cell">{t.paidBy.name}</td>
                        <td className="hidden sm:table-cell"><Badge dot tone={t.shared ? "success" : "muted"}>{t.shared ? "Commune" : "Perso"}</Badge></td>
                        <td className={`num font-bold ${income ? "text-pos" : "text-heading"}`}>{income ? "+" : "−"}{money(t.amount)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <SectionHeader title="Échéances à venir" subtitle={`Charges et crédits de ${monthLabel(d.month)}`} action={<Link href="/charges" className="tap-link text-label font-bold">Voir les charges</Link>} />
          {due.length === 0 ? (
            <EmptyState title="Aucune échéance ce mois-ci" />
          ) : (
            <ul className="due-list">
              {due.map((c) => (
                <li key={c.id}>
                  <Link href={c.loanId ? `/credits/${c.loanId}` : `/charges/${c.id}`}>
                    <span className="date-tile"><b>{String(c.due.getUTCDate()).padStart(2, "0")}</b><small>{fmt({ month: "short" }).format(c.due)}</small></span>
                    <span className="min-w-0 flex-1">
                      <b className="block truncate text-heading">{c.name}</b>
                      <small className="block truncate text-label text-faint">{c.loanId ? "Crédit" : "Charge fixe"}{!c.budgeted && " · absente du budget"}</small>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <b className="ab-num text-heading">{money(c.amount)}</b>
                      <Badge dot tone={STATUS[c.status][0]}>{STATUS[c.status][1]}</Badge>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="card-foot">
            <span className="text-label text-muted">{d.unpaid.length} à payer{d.late.count > 0 && ` · ${d.late.count} en retard`}</span>
            <b className="ab-num">Total dû : {money(d.toPay)}</b>
          </div>
        </Card>
      </div>

      <section className="mt-10" aria-labelledby="details">
        <p className="eyebrow">Informations complémentaires</p>
        <h2 id="details" className="mt-1">Détails du mois</h2>
        {budget && (
          <Card className="mb-4">
            <SectionHeader title="Synthèse du budget" subtitle="Prévu au budget, et réel des opérations enregistrées" action={<Link href={budgetHref} className="tap-link text-label font-bold">Voir le budget</Link>} />
            <dl className="facts">
              {[
                ["Total des revenus", budget.totals.income, `Réel ${money(actual.income)}`],
                ["Charges fixes", budget.totals.fixed, `Réel ${money(actual.fixed)}`],
                ["Charges variables", budget.totals.variable, `Réel ${money(actual.variable)}`],
                ["Épargne", budget.totals.savings, `Prévu, ou versé s’il est plus élevé · réel ${money(actual.savings)}`],
                ["Reste prévisionnel", budget.totals.remaining, "Revenus − fixes − variables − épargne"],
                ["Reste réel (budget)", actual.remaining, "Mêmes calculs sur les opérations enregistrées du mois"],
              ].map(([label, value, note]) => (
                <div key={label as string}>
                  <dt>{label}</dt>
                  <dd className={`ab-num ${(value as number) < 0 ? "text-neg" : ""}`}>{money(value as number)}</dd>
                  <small>{note}</small>
                </div>
              ))}
            </dl>
          </Card>
        )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Fold title="Enveloppes communes" className="lg:col-span-2" aside={<Link href={budgetHref} className="tap-link text-sm">Voir le budget</Link>}>
          {env.length === 0 ? (
            <EmptyState title="Aucune enveloppe ce mois-ci">Les enveloppes communes du budget apparaîtront ici.</EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Libellé</th><th className="num">Prévu</th><th className="num">Réel</th><th className="num">Restant</th></tr></thead>
                <tbody>
                  {env.map((e) => (
                    <tr key={e.id}>
                      <td>{e.label}</td>
                      <td className="num">{money(e.planned)}</td>
                      <td className="num">{money(e.actual)}</td>
                      <td className={`num ${e.left < 0 ? "text-neg" : "text-heading"}`}>{money(e.left)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Fold>

        {split && (
          <Fold className="lg:col-span-2" title="Partage" aside={<span className="amount" title="Dépenses communes prévues, moins les recettes communes">{money(split.commonNet)}</span>}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Membre</th><th className="num">Revenu</th><th className="num">Part</th><th className="num">Dû</th>
                    <th className="num">Communes payées</th><th className="num">Reste à verser</th><th className="num">Reste perso</th>
                  </tr>
                </thead>
                <tbody>
                  {split.members.map((m) => (
                    <tr key={m.userId}>
                      <td>{m.name}</td>
                      <td className="num">{money(m.income)}</td>
                      <td className="num">{percent.format(m.shareBp / 10000)}</td>
                      <td className="num">{money(m.due)}</td>
                      <td className="num">{money(m.contribution)}</td>
                      <td className="num text-heading">{m.toTransfer < 0 ? <>à recevoir {money(-m.toTransfer)}</> : money(m.toTransfer)}</td>
                      <td className="num">{money(m.personalLeft)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Fold>
        )}

        <Fold title="Échéances du mois" aside={<span className="amount">{money(fixedTotal)}</span>}>
          {fixed.length === 0 && planned.length === 0 && <p className="m-0 text-sm text-muted">Aucune charge fixe ce mois-ci.</p>}
          {fixed.map((c) => (
            <Link key={c.id} href={`/charges/${c.id}`} className="flex min-h-11 items-center justify-between gap-3 border-t border-hairline py-2">
              <span>{c.name} <small className="text-muted">· le {c.due.getUTCDate()}{!c.budgeted && " · absente du budget"}</small></span>
              <span className="amount">{money(c.amount)}</span>
            </Link>
          ))}
          {planned.map((l) => (
            <div key={l.id} className="flex min-h-11 items-center justify-between gap-3 border-t border-hairline py-2">
              <span>{l.label} <small className="text-muted">· prévu au budget</small></span>
              <span className="amount">{money(l.amount)}</span>
            </div>
          ))}
        </Fold>
        <Fold title="Crédits en cours" aside={<span className="amount">{money(loanTotal)}</span>}>
          {loans.length === 0 && <p className="m-0 text-sm text-muted">Aucun crédit en cours ce mois-ci.</p>}
          {loans.map((c) => (
            <Link key={c.id} href={`/credits/${c.loanId}`} className="flex min-h-11 items-center justify-between gap-3 border-t border-hairline py-2">
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
        <section className="mt-6" aria-labelledby="analyse">
          <h2 id="analyse" className="mt-0 mb-3">Analyse des dépenses</h2>
          <AnalyticsBento
            currency={currency}
            data={charts}
            aside={spent && <Card className="w6"><SpendingByCategory currency={currency} data={charts.categories} /></Card>}
          />
        </section>
      )}

      </section>

      <details>
        <summary>Saisie rapide d’une opération</summary>
        {/* Clé = dernière opération : une saisie réussie change la clé, le formulaire repart vide. */}
        <EntryForm key={d.recent[0]?.id} back="dashboard" members={members} categories={categories} v={{ occurredOn: todayStr, paidById: user.id }} />
      </details>
    </>
  );
}
