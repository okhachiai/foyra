import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listCategories } from "@/lib/categories";
import { addMonths } from "@/lib/amortization";
import { actualTotals, envelopes, formatMonth, parseMonth, uncoveredFixedLines } from "@/lib/budget";
import { getSplit } from "@/lib/split";
import { getDashboard, getDashboardCharts, spendingPlan, upcomingCharges } from "@/lib/dashboard";
import { dateFmt, monthLabel, parseDay, payers, todayIn } from "@/lib/ledger";
import { getI18n } from "@/lib/i18n-server";
import { configuredProviders } from "@/lib/llm";
import { formatCents, formatWhole } from "@/lib/money";
import { getSavings } from "@/lib/savings";
import { Badge } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { DateTile } from "@/components/ui/date-tile";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { MonthNav } from "@/components/ui/month-nav";
import { PageHeader } from "@/components/ui/page-header";
import { ProgressBar } from "@/components/ui/progress";
import { analyzeAction } from "@/app/actions";
import { ActionForm } from "@/app/form";
import { EntryForm } from "../transactions/entry-form";
import { Fold } from "../budget/fold";
import { AnalyticsBento, CashFlow, KpiRow, SpendingByCategory, type Kpi } from "./charts";

const STATUS = { paid: ["success", "Paid"], due: ["warning", "Upcoming"], late: ["danger", "Late"] } as const;

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const user = await requireUser();
  const { t, intl } = await getI18n();
  const percent = new Intl.NumberFormat(intl, { style: "percent", maximumFractionDigits: 2 });
  const shortDate = (d: Date) => dateFmt({ day: "numeric", month: "short" }, intl).format(d);
  const month_ = (m: Date) => monthLabel(m, intl);
  const todayStr = todayIn(user.household.timezone);
  const today = parseDay(todayStr)!;
  const month = parseMonth((await searchParams).m) ?? parseMonth(todayStr.slice(0, 7))!;
  // Charts stop at the last day of the shown month, never past today, nor before the 1st of the shown month (future month).
  const asOf = new Date(Math.max(month.getTime(), Math.min(today.getTime(), addMonths(month, 1).getTime() - 86_400_000)));
  const [d, categories, members] = await Promise.all([getDashboard(user.householdId, today, month), listCategories(user.householdId), payers(user.householdId)]);
  const currency = user.household.currency;
  const money = (cents: number) => formatCents(cents, currency, intl);
  const round = (cents: number) => formatWhole(cents, currency, intl);
  const { budget, charges } = d;
  const [charts, actual, split, savings] = await Promise.all([
    // Charts only when real transactions exist: never an invented curve.
    d.recent.length ? getDashboardCharts(user.householdId, asOf, intl) : null,
    actualTotals(user.householdId, d.month),
    // Split: useful from two members.
    getSplit(user.householdId, d.month).then((s) => (s.members.length > 1 ? s : null)),
    getSavings(user.householdId, d.month, 3),
  ]);
  const { lines, reserve } = budget ? envelopes(budget.tree) : { lines: [], reserve: null };
  const env = [...lines, ...(reserve ? [reserve] : [])];
  const plan = budget && spendingPlan(budget.tree);
  // The month's fixed charges and loans, computed live: a paid-off loan no longer shows.
  const fixed = charges.filter((c) => !c.loanId), loans = charges.filter((c) => c.loanId);
  const sum = (l: typeof charges) => l.reduce((s, c) => s + c.amount, 0);
  // Fixed budget lines without a recurring charge: listed too, without a due day.
  const planned = budget ? uncoveredFixedLines(budget.tree, new Set(charges.map((c) => c.categoryId))) : [];
  const fixedTotal = sum(fixed) + planned.reduce((s, l) => s + l.amount, 0), loanTotal = sum(loans);
  const spent = charts && charts.categories.periods[0].total > 0;
  // Curves: day-by-day running total from 0 to asOf (always ≥ 2 points), compared with the same day of the previous month.
  const day = asOf.getUTCDate();
  const flow = (a: number[][] | undefined) => ({ series: a ? [0, ...a[0].slice(0, day)] : null, prev: a?.[1][day - 1] ?? null });
  const netFlow = charts && charts.flows.income.map((r, k) => r.map((v, i) => v - charts.flows.expense[k][i]));
  const savingsPlanned = d.budget?.totals.savings ?? 0;
  const used = plan && plan.planned ? Math.round((plan.actual / plan.planned) * 100) : null;
  const kpis: Kpi[] = [
    {
      // Same computation as the budget's "actual remainder": the month's transactions only, never a bank balance.
      label: t("Available"), icon: "wallet", tone: "hero", value: d.net, prev: null, colors: ["var(--hero-muted)", "var(--hero-text)"],
      series: flow(netFlow ?? undefined).series,
      note: t("Income received − spending and savings recorded this month. This is not a bank balance."),
    },
    { label: t("Income this month"), icon: "arrowIn", tone: "accent", value: d.income, note: t(d.budget ? "Entered in the month’s budget" : "No budget this month"), colors: ["var(--chart-1-soft)", "var(--chart-1)"], ...flow(charts?.flows.income) },
    {
      label: t("Spending this month"), icon: "arrowOut", tone: "expense", value: d.expense, upIsGood: false, colors: ["var(--chart-2-soft)", "var(--chart-2)"], ...flow(charts?.flows.expense),
      note: used !== null && plan ? t("{pct}% of the spending budget ({amount})", { pct: used, amount: round(plan.planned) }) : t("Recorded transactions, no spending budget"),
    },
    {
      label: t("Savings this month"), icon: "target", tone: "info", value: actual.savings, series: null, prev: null, colors: ["var(--chart-4)", "var(--chart-4)"],
      note: savingsPlanned ? t("{pct}% of the {amount} planned in the budget", { pct: Math.round((actual.savings / savingsPlanned) * 100), amount: round(savingsPlanned) }) : t("Deposits this month, nothing planned in the budget"),
      progress: savingsPlanned ? { value: actual.savings, max: savingsPlanned, label: t("Savings paid in vs planned") } : undefined,
    },
  ];
  const current = formatMonth(month) === todayStr.slice(0, 7);
  const due = upcomingCharges(charges, today);
  const recentSavings = [...savings.series].reverse();
  // Situation sentence: only figures computed above.
  const situation = [
    t("{month}: {amount} of spending recorded", { month: month_(d.month).replace(/^./, (c) => c.toUpperCase()), amount: round(d.expense) }),
    d.budget && t("planned remainder {amount}", { amount: round(d.budget.totals.remaining) }),
    d.unpaid.length > 0 && t(d.unpaid.length > 1 ? "{n} payments due" : "{n} payment due", { n: d.unpaid.length }) + (d.late.count ? t(", {n} of them late", { n: d.late.count }) : ""),
  ].filter(Boolean).join(" · ");
  const budgetHref = `/budget?m=${formatMonth(month)}`;

  return (
    <>
      <PageHeader
        eyebrow={`Foyra / ${t("Overview")}`}
        title={t("Your money, crystal clear.")}
        subtitle={<>{situation}.{!current && <> <Link href="/dashboard">{t("Back to the current month")}</Link></>}</>}
        actions={
          <>
            {configuredProviders(user.household).length > 0 && (
              <ActionForm action={analyzeAction} className="inline">
                <input type="hidden" name="month" value={formatMonth(month)} />
                <button type="submit" className="ghost"><Icon name="reports" className="size-4" />{t("Analyse {month}", { month: monthLabel(month, intl) })}</button>
              </ActionForm>
            )}
            <a href={`/budget/export?m=${formatMonth(month)}`} className="button ghost"><Icon name="download" className="size-4" />{t("Export")}</a>
            <MonthNav path="/dashboard" month={month} />
            <Link href="/transactions/new?back=dashboard" className="button"><Icon name="plus" className="size-4" />{t("Add a transaction")}</Link>
          </>
        }
      />

      <KpiRow currency={currency} items={kpis} />

      <div className="dash-analysis">
        <Card className="w-cash">
          <SectionHeader title={t("Cash flow")} subtitle={t("Income, spending and monthly result (recorded transactions)")} />
          {charts ? <CashFlow currency={currency} data={charts.monthly} /> : <EmptyState title={t("No transactions recorded")}>{t("The bars will appear with the first transactions.")}</EmptyState>}
        </Card>

        <Card>
          <SectionHeader
            title={t("Spending budget")}
            subtitle={`${t("Actual / planned")} · ${month_(d.month)}`}
            action={used !== null && <Badge tone={used > 100 ? "danger" : used > 90 ? "warning" : "success"}>{used}%</Badge>}
          />
          {plan && plan.lines.length > 0 ? (
            <>
              <ul className="plan-list">
                {plan.lines.slice(0, 5).map((l) => (
                  <li key={l.id}>
                    <div className="plan-row"><b>{l.label}</b><span className="ab-num">{round(l.actual)} / {round(l.planned)}</span></div>
                    <ProgressBar value={l.actual} max={l.planned} label={`${l.label}: ${t("Share of planned spent")}`} />
                    <small className={l.left < 0 ? "text-neg font-semibold" : undefined}>{l.left < 0 ? t("Over by {amount}", { amount: round(-l.left) }) : t("{amount} left", { amount: round(l.left) })}</small>
                  </li>
                ))}
              </ul>
              <div className="card-foot">
                <span className="text-label text-muted">{t("Remaining")} <b className={`ab-num ${plan.left < 0 ? "text-neg" : "text-heading"}`}>{round(plan.left)}</b></span>
                <Link href={budgetHref} className="tap-link text-label font-bold">{plan.lines.length > 5 ? `${t("Full budget")} (+${plan.lines.length - 5})` : t("Full budget")}</Link>
              </div>
            </>
          ) : (
            <EmptyState title={t("No spending budget")} action={<Link href={budgetHref}>{t("Prepare the budget")}</Link>}>
              {t("The budget’s spending lines will appear here, with their actuals.")}
            </EmptyState>
          )}
        </Card>

        <Card>
          <SectionHeader
            title={t("Savings")}
            subtitle={t("Paid in vs planned, last 3 months")}
            action={<Link href="/savings" className="icon-link" aria-label={t("Set aside")}><Icon name="plus" className="size-4" /></Link>}
          />
          {recentSavings.some((m) => m.planned || m.actual) ? (
            <>
              <ul className="plan-list">
                {recentSavings.map((m) => {
                  const ratio = m.planned ? Math.round((m.actual / m.planned) * 100) : null;
                  return (
                    <li key={m.month}>
                      <div className="plan-row">
                        <b className="first-letter:uppercase">{month_(parseMonth(m.month)!)}</b>
                        <span className="ab-num font-bold text-accent-ink">{ratio === null ? "—" : `${ratio}%`}</span>
                      </div>
                      <ProgressBar value={m.actual} max={Math.max(m.planned, m.actual)} tone="info" label={t("Savings for {month}: paid in vs planned", { month: m.month })} />
                      <small>{m.planned ? t("{paid} paid in of {planned}", { paid: round(m.actual), planned: round(m.planned) }) : t("{paid} paid in, nothing planned", { paid: round(m.actual) })}</small>
                    </li>
                  );
                })}
              </ul>
              <div className="card-foot">
                <span className="text-label text-muted">{t("Total saved")}</span>
                <b className="ab-num">{money(savings.series.at(-1)!.cumulative)}</b>
              </div>
            </>
          ) : (
            <EmptyState title={t("No savings in the last three months")} action={<Link href="/savings">{t("Set aside")}</Link>} />
          )}
        </Card>
      </div>

      <div className="dash-activity">
        <Card variant="table">
          <SectionHeader title={t("Latest transactions")} subtitle={t("Up to the end of {month}", { month: month_(d.month) })} action={<Link href="/transactions" className="tap-link text-label font-bold">{t("See all")}</Link>} />
          {d.recent.length === 0 ? (
            <EmptyState title={t("No transactions")} action={<Link href="/transactions/new?back=dashboard">{t("Add a transaction")}</Link>} />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>{t("Transaction")}</th><th className="hidden sm:table-cell">{t("Paid by")}</th><th className="hidden sm:table-cell">{t("Status")}</th><th className="num">{t("Amount")}</th></tr>
                </thead>
                <tbody>
                  {d.recent.map((tx) => {
                    const cat = tx.category ? (tx.category.parent ? `${tx.category.parent.name} › ${tx.category.name}` : tx.category.name) : null;
                    const income = tx.kind === "INCOME";
                    return (
                      <tr key={tx.id}>
                        <td className="w-full max-w-0">
                          <div className="flex items-center gap-3">
                            <span className={`row-icon ${income ? "accent" : "expense"}`}><Icon name={income ? "arrowIn" : "arrowOut"} className="size-4" /></span>
                            <span className="min-w-0">
                              <Link href={`/transactions/${tx.id}`} className="block truncate text-heading no-underline hover:underline">{cat ?? tx.note ?? t(income ? "Income" : "Expense")}</Link>
                              <small className="block truncate text-label font-medium text-faint">{shortDate(tx.occurredOn)}{cat && tx.note ? ` · ${tx.note}` : ""}</small>
                            </span>
                          </div>
                        </td>
                        <td className="hidden sm:table-cell">{tx.paidBy.name}</td>
                        <td className="hidden sm:table-cell"><Badge dot tone={tx.shared ? "success" : "muted"}>{t(tx.shared ? "Shared" : "Personal")}</Badge></td>
                        <td className={`num font-bold ${income ? "text-pos" : "text-heading"}`}>{income ? "+" : "−"}{money(tx.amount)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <SectionHeader title={t("Upcoming payments")} subtitle={t("Charges and loans for {month}", { month: month_(d.month) })} action={<Link href="/charges" className="tap-link text-label font-bold">{t("See charges")}</Link>} />
          {due.length === 0 ? (
            <EmptyState title={t("No payments due this month")} />
          ) : (
            <ul className="due-list">
              {due.map((c) => (
                <li key={c.id}>
                  <Link href={c.loanId ? `/loans/${c.loanId}` : `/charges/${c.id}`}>
                    <DateTile date={c.due} />
                    <span className="min-w-0 flex-1">
                      <b className="block truncate text-heading">{c.name}</b>
                      <small className="block truncate text-label text-faint">{t(c.loanId ? "Loan" : "Fixed charge")}{!c.budgeted && ` · ${t("not in the budget")}`}</small>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <b className="ab-num text-heading">{money(c.amount)}</b>
                      <Badge dot tone={STATUS[c.status][0]}>{t(STATUS[c.status][1])}</Badge>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="card-foot">
            <span className="text-label text-muted">{t("{n} to pay", { n: d.unpaid.length })}{d.late.count > 0 && ` · ${t("{n} late", { n: d.late.count })}`}</span>
            <b className="ab-num">{t("Total due: {amount}", { amount: money(d.toPay) })}</b>
          </div>
        </Card>
      </div>

      <section className="mt-10" aria-labelledby="details">
        <p className="eyebrow">{t("Additional information")}</p>
        <h2 id="details" className="mt-1">{t("Month details")}</h2>
        {budget && (
          <Card className="mb-4">
            <SectionHeader title={t("Budget summary")} subtitle={t("Planned in the budget, and actuals from recorded transactions")} action={<Link href={budgetHref} className="tap-link text-label font-bold">{t("See the budget")}</Link>} />
            <dl className="facts">
              {[
                [t("Total income"), budget.totals.income, t("Actual {amount}", { amount: money(actual.income) })],
                [t("Fixed charges"), budget.totals.fixed, t("Actual {amount}", { amount: money(actual.fixed) })],
                [t("Variable expenses"), budget.totals.variable, t("Actual {amount}", { amount: money(actual.variable) })],
                [t("Savings"), budget.totals.savings, t("Planned, or paid in if higher · actual {amount}", { amount: money(actual.savings) })],
                [t("Planned remainder"), budget.totals.remaining, t("Income − fixed − variable − savings")],
                [t("Actual remainder (budget)"), actual.remaining, t("Same computation on the month’s recorded transactions")],
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
        <Fold title={t("Shared envelopes")} className="lg:col-span-2" aside={<Link href={budgetHref} className="tap-link text-sm">{t("See the budget")}</Link>}>
          {env.length === 0 ? (
            <EmptyState title={t("No envelopes this month")}>{t("The budget’s shared envelopes will appear here.")}</EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>{t("Label")}</th><th className="num">{t("Planned")}</th><th className="num">{t("Actual")}</th><th className="num">{t("Remaining")}</th></tr></thead>
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
          <Fold className="lg:col-span-2" title={t("Split")} aside={<span className="amount" title={t("Planned shared expenses, minus shared income")}>{money(split.commonNet)}</span>}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t("Member")}</th><th className="num">{t("Income")}</th><th className="num">{t("Share")}</th><th className="num">{t("Due")}</th>
                    <th className="num">{t("Shared paid")}</th><th className="num">{t("Left to transfer")}</th><th className="num">{t("Personal left")}</th>
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
                      <td className="num text-heading">{m.toTransfer < 0 ? t("to receive {amount}", { amount: money(-m.toTransfer) }) : money(m.toTransfer)}</td>
                      <td className="num">{money(m.personalLeft)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Fold>
        )}

        <Fold title={t("This month’s payments")} aside={<span className="amount">{money(fixedTotal)}</span>}>
          {fixed.length === 0 && planned.length === 0 && <p className="m-0 text-sm text-muted">{t("No fixed charges this month.")}</p>}
          {fixed.map((c) => (
            <Link key={c.id} href={`/charges/${c.id}`} className="flex min-h-11 items-center justify-between gap-3 border-t border-hairline py-2">
              <span>{c.name} <small className="text-muted">· {t("on the {day}", { day: c.due.getUTCDate() })}{!c.budgeted && ` · ${t("not in the budget")}`}</small></span>
              <span className="amount">{money(c.amount)}</span>
            </Link>
          ))}
          {planned.map((l) => (
            <div key={l.id} className="flex min-h-11 items-center justify-between gap-3 border-t border-hairline py-2">
              <span>{l.label} <small className="text-muted">· {t("planned in the budget")}</small></span>
              <span className="amount">{money(l.amount)}</span>
            </div>
          ))}
        </Fold>
        <Fold title={t("Current loans")} aside={<span className="amount">{money(loanTotal)}</span>}>
          {loans.length === 0 && <p className="m-0 text-sm text-muted">{t("No current loans this month.")}</p>}
          {loans.map((c) => (
            <Link key={c.id} href={`/loans/${c.loanId}`} className="flex min-h-11 items-center justify-between gap-3 border-t border-hairline py-2">
              <span>
                {c.name}
                {c.installment && (
                  <small className="block text-muted">
                    {t("First payment {date}", { date: dateFmt({ dateStyle: "short" }, intl).format(c.installment.firstDue) })} · {t("payment {n}/{of}", { n: c.installment.n, of: c.installment.of })}
                    {c.installment.n === c.installment.of && ` · ${t("last")}`}
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
          <h2 id="analyse" className="mt-0 mb-3">{t("Spending analysis")}</h2>
          <AnalyticsBento
            currency={currency}
            data={charts}
            aside={spent && <Card className="w6"><SpendingByCategory currency={currency} data={charts.categories} /></Card>}
          />
        </section>
      )}

      </section>

      <Fold id="dash-quick-entry" title={t("Quick transaction entry")} className="mt-6">
        {/* Key = latest transaction: a successful entry changes the key, the form starts empty again. */}
        <EntryForm key={d.recent[0]?.id} back="dashboard" members={members} categories={categories} v={{ occurredOn: todayStr, paidById: user.id }} />
      </Fold>
    </>
  );
}
