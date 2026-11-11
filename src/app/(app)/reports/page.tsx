import Link from "next/link";
import type { ReportKind, ReportTrigger } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { getBudget } from "@/lib/budget";
import { configuredProviders, PROVIDER_LABELS } from "@/lib/llm";
import { formatCents } from "@/lib/money";
import { dateFmt, monthLabel } from "@/lib/ledger";
import { getI18n } from "@/lib/i18n-server";
import type { T } from "@/lib/i18n";
import { listReports, type DailyInput, type DailyOutput, type MonthlyInput, type MonthlyOutput, type Pace, type PlanInput, type PlanOutput } from "@/lib/report";
import { Badge } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon, type IconName } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { analyzeAction, applyPlanAction } from "@/app/actions";
import { ActionForm, Field } from "@/app/form";

// English source labels, translated with t().
const TRIGGERS: Record<ReportTrigger, string> = { MANUAL: "On demand", AUTO: "Automatic" };
const KINDS: Record<ReportKind, string> = { DAILY: "Daily report", MONTHLY: "Month review", PLAN: "Budget preparation" };
// Reports stored before the English rename keep their French pace values ("rapide", "dépassé").
const PACE: Record<Pace | "rapide" | "dépassé", { label: string; tone: "success" | "warning" | "danger" }> = {
  ok: { label: "On pace", tone: "success" },
  fast: { label: "Too fast", tone: "warning" },
  over: { label: "Over", tone: "danger" },
  rapide: { label: "Too fast", tone: "warning" },
  dépassé: { label: "Over", tone: "danger" },
};
const GROUPS = { income: "Income", fixed: "Fixed charges", savings: "Savings", variable: "Variable expenses" } as const;

type Money = (cents: number) => string;
type Ctx = { money: Money; t: T; intl: string };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ id?: string; lines?: string }> }) {
  const user = await requireUser();
  const { t, intl } = await getI18n();
  const { id, lines } = await searchParams;
  const providers = configuredProviders(user.household);
  const reports = await listReports(user);
  const report = id ? reports.find((r) => r.id === id) : reports[0];
  const money: Money = (cents) => formatCents(cents, user.household.currency, intl);
  const ctx: Ctx = { money, t, intl };
  const when = new Intl.DateTimeFormat(intl, { dateStyle: "short", timeStyle: "short", timeZone: user.household.timezone });

  return (
    <>
      <PageHeader eyebrow={`Foyra / ${t("AI reports")}`} title={t("AI reports")} subtitle={t("Analyses of your budget: figures computed by Foyra, comments written by the AI.")} />
      {lines && <p role="status" className="alert success mb-4"><Icon name="shield" className="size-5 shrink-0" />{t("Allocation applied: {n} budget line(s) updated.", { n: lines })}</p>}

      <div className="grid items-start gap-4 lg:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-8">
          {id && !report && <p className="alert danger" role="alert"><Icon name="alert" className="size-5 shrink-0" />{t("Report not found.")}</p>}
          {!report && !id && <EmptyState title={t("No reports")}>{t("Generated reports will appear here.")}</EmptyState>}
          {report && (
            <>
              <Card>
                <SectionHeader
                  title={t(KINDS[report.kind])}
                  subtitle={<>{dateFmt({ dateStyle: "short" }, intl).format(report.day)} · {t(TRIGGERS[report.trigger])} · {t(PROVIDER_LABELS[report.provider])}{report.model && ` (${report.model})`}</>}
                  action={report.error ? <Badge dot tone="danger">{t("Error")}</Badge> : <Badge dot tone="success">{t("Ready")}</Badge>}
                />
                {report.error && <p className="alert danger" role="alert"><Icon name="alert" className="size-5 shrink-0" />{t("The report failed: {error}", { error: t(report.error) })}</p>}
              </Card>
              {report.output && report.kind === "DAILY" && <Daily input={report.input as DailyInput} output={report.output as DailyOutput} {...ctx} />}
              {report.output && report.kind === "MONTHLY" && <Monthly input={report.input as MonthlyInput} output={report.output as MonthlyOutput} {...ctx} />}
              {report.output && report.kind === "PLAN" && (
                <Plan reportId={report.id} householdId={user.householdId} budgetId={report.budgetId} input={report.input as PlanInput} output={report.output as PlanOutput} {...ctx} />
              )}
            </>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-4 lg:col-span-4">
          <Card>
            <SectionHeader title={t("New report")} subtitle={t("The variable expense allocation is prepared from the Budget page.")} />
            {providers.length > 0 ? (
              <ActionForm action={analyzeAction} className="form" pendingNotice={t("The AI is analysing your budget… this can take a few minutes with a local model.")}>
                {providers.length > 1 && (
                  <Field name="provider" label={t("Provider")}>
                    <select name="provider" defaultValue="">
                      <option value="">{t("Household setting")}</option>
                      {providers.map((p) => <option key={p} value={p}>{t(PROVIDER_LABELS[p])}</option>)}
                    </select>
                  </Field>
                )}
                <div className="flex flex-wrap gap-2">
                  <button type="submit" name="kind" value="DAILY"><Icon name="reports" className="size-4" />{t("Daily report")}</button>
                  <button type="submit" name="kind" value="MONTHLY" className="secondary">{t("Last month’s review")}</button>
                </div>
              </ActionForm>
            ) : (
              <EmptyState title={t("No AI provider configured")} action={<Link href="/settings/ai">{t("Open settings")}</Link>}>{t("Choose a provider in Settings to generate reports.")}</EmptyState>
            )}
          </Card>

          {reports.length > 0 && (
            <Card>
              <SectionHeader title={t("History")} subtitle={t(reports.length > 1 ? "{n} reports" : "{n} report", { n: reports.length })} />
              <ul className="due-list">
                {reports.map((r) => (
                  <li key={r.id}>
                    <Link href={`/reports?id=${r.id}`} aria-current={r.id === report?.id ? "page" : undefined}>
                      <span className={`row-icon ${r.error ? "expense" : ""}`}><Icon name={r.error ? "alert" : "reports"} className="size-4" /></span>
                      <span className="min-w-0 flex-1">
                        <b className="block truncate text-heading">{t(KINDS[r.kind])}</b>
                        <small className="block truncate text-label text-faint">{when.format(r.createdAt)} · {t(TRIGGERS[r.trigger])}</small>
                      </span>
                      {r.error ? <Badge dot tone="danger">{t("Error")}</Badge> : <Badge dot tone="success">{t("Ready")}</Badge>}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

const POINTS = {
  alert: { icon: "alert", cls: "expense" },
  advice: { icon: "target", cls: "" },
  done: { icon: "shield", cls: "" },
} satisfies Record<string, { icon: IconName; cls: string }>;

/** List of LLM sentences (alerts, advice, kept points); nothing when empty. */
function Points({ title, items, kind }: { title: string; items: string[]; kind: keyof typeof POINTS }) {
  if (!items.length) return null;
  return (
    <Card className={kind === "alert" ? "card-alert" : undefined}>
      <div className="kpi-top">
        <span className={`kpi-icon ${POINTS[kind].cls}`}><Icon name={POINTS[kind].icon} className="size-4" /></span>
        <h2 className="m-0 text-section font-bold text-heading">{title}</h2>
        <Badge tone={kind === "alert" ? "danger" : "muted"} className="ms-auto">{items.length}</Badge>
      </div>
      <ul className="points">
        {items.map((x, i) => <li key={i}>{x}</li>)}
      </ul>
    </Card>
  );
}

/** Summary written by the LLM. */
function Summary({ title, text, label }: { title: string; text: string; label: string }) {
  return (
    <Card>
      <p className="eyebrow">{label}</p>
      <h2 className="m-0 text-section font-bold text-heading">{title}</h2>
      <p className="m-0 text-body leading-relaxed">{text}</p>
    </Card>
  );
}

/** Daily report: the app's figures at report time, the LLM's texts. */
function Daily({ input, output, money, t }: { input: DailyInput; output: DailyOutput } & Ctx) {
  return (
    <>
      <Summary label={t("Summary")} title={t("Where the month stands · day {day} of {days}", { day: input.day, days: input.daysInMonth })} text={output.summary} />
      <div className="stat-group">
        <Stat label={t("Variable expenses")} value={money(input.actual.variable)} note={t("planned {amount}", { amount: money(input.planned.variable) })} />
        <Stat label={t("Actual remainder")} value={money(input.actual.remaining)} tone={input.actual.remaining < 0 ? "neg" : undefined} note={t("planned {amount}", { amount: money(input.planned.remaining) })} />
        <Stat label={t("Uncategorized")} value={money(input.uncategorized.amount)} note={t("{n} expense(s)", { n: input.uncategorized.count })} />
      </div>
      <Points title={t("Alerts")} items={output.alerts} kind="alert" />
      <Points title={t("Recommendations")} items={output.advice} kind="advice" />

      <Card variant="table">
        <SectionHeader title={t("Envelopes")} subtitle={t("Expected = planned pro rata of days elapsed; projection = end of month at the current pace.")} />
        {input.lines.length === 0 ? (
          <p className="m-0 text-label text-muted">{t("No variable expense lines.")}</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("Line")}</th>
                  <th className="num hidden sm:table-cell">{t("Planned")}</th>
                  <th className="num">{t("Spent")}</th>
                  <th className="num hidden md:table-cell">{t("Expected")}</th>
                  <th className="num hidden sm:table-cell">{t("Projection")}</th>
                  <th className="num hidden lg:table-cell">{t("Per remaining day")}</th>
                  <th>{t("Pace")}</th>
                </tr>
              </thead>
              <tbody>
                {input.lines.map((l, i) => (
                  <tr key={i}>
                    <td className="break-words">{l.label}<small className="block text-label font-medium text-faint sm:hidden">{t("planned {amount}", { amount: money(l.planned) })} · {t("projection {amount}", { amount: money(l.projected) })}</small></td>
                    <td className="num hidden sm:table-cell">{money(l.planned)}</td>
                    <td className="num">{money(l.actual)}</td>
                    <td className="num hidden md:table-cell">{money(l.expected)}</td>
                    <td className={`num hidden sm:table-cell ${l.projected > l.planned ? "text-neg" : ""}`}>{money(l.projected)}</td>
                    <td className="num hidden lg:table-cell">{money(l.perDay)}</td>
                    <td><Badge dot tone={PACE[l.status].tone}>{t(PACE[l.status].label)}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {input.todayOps.length > 0 && (
        <Card>
          <SectionHeader title={t("Today’s transactions")} />
          <ul className="due-list">
            {input.todayOps.map((op, i) => (
              <li key={i}>
                <div className="due-row">
                  <span className={`row-icon ${op.kind === "EXPENSE" ? "expense" : ""}`}><Icon name={op.kind === "EXPENSE" ? "arrowOut" : "arrowIn"} className="size-4" /></span>
                  <span className="min-w-0 flex-1">
                    <b className="block break-words text-heading">{op.label || "—"}</b>
                    <small className="block text-label text-faint">{op.category ?? t("Uncategorized")} · {op.paidBy}</small>
                  </span>
                  <b className={`ab-num shrink-0 ${op.kind === "EXPENSE" ? "text-neg" : "text-pos"}`}>{op.kind === "EXPENSE" ? "−" : "+"}{money(op.amount)}</b>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

/** Month review: planned on the 1st vs actual. */
function Monthly({ input, output, money, t, intl }: { input: MonthlyInput; output: MonthlyOutput } & Ctx) {
  return (
    <>
      <Summary label={t("Summary")} title={t("Review of {month}", { month: monthLabel(new Date(`${input.month}-01`), intl) })} text={output.verdict} />
      <div className="stat-group">
        <Stat label={t("Actual remainder")} value={money(input.actual.remaining)} tone={input.actual.remaining < input.planned.remaining ? "neg" : "pos"} note={t("planned {amount}", { amount: money(input.planned.remaining) })} />
        <Stat label={t("Savings achieved")} value={money(input.actual.savings)} tone={input.actual.savings < input.planned.savings ? "neg" : "pos"} note={t("planned {amount}", { amount: money(input.planned.savings) })} />
        <Stat label={t("Off budget")} value={money(input.offBudget)} note={t("Expenses without a budget line")} />
      </div>
      <Points title={t("Mistakes to avoid")} items={output.mistakes} kind="alert" />
      <Points title={t("Recommendations for next month")} items={output.advice} kind="advice" />
      <Points title={t("Points kept")} items={output.respected} kind="done" />

      <Card variant="table">
        <SectionHeader title={t("Planned vs actual")} />
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t("Line")}</th>
                <th className="hidden md:table-cell">{t("Type")}</th>
                <th className="num hidden sm:table-cell">{t("Planned")}</th>
                <th className="num">{t("Actual")}</th>
                <th className="num">{t("Gap")}</th>
              </tr>
            </thead>
            <tbody>
              {input.lines.map((l, i) => {
                // Unfavourable gap: expense above planned, income below.
                const bad = l.group === "income" ? l.diff < 0 : l.diff > 0;
                return (
                  <tr key={i}>
                    <td className="break-words">{l.label}<small className="block text-label font-medium text-faint md:hidden">{t(GROUPS[l.group])}<span className="sm:hidden"> · {t("planned {amount}", { amount: money(l.planned) })}</span></small></td>
                    <td className="hidden text-muted md:table-cell">{t(GROUPS[l.group])}</td>
                    <td className="num hidden sm:table-cell">{money(l.planned)}</td>
                    <td className="num">{money(l.actual)}</td>
                    <td className={`num font-bold ${l.diff && bad ? "text-neg" : l.diff ? "text-pos" : ""}`}>{l.diff > 0 ? "+" : ""}{money(l.diff)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

/** Budget preparation: proposed allocation of the remainder over variable expenses, applicable to the (draft) budget. */
async function Plan({ reportId, householdId, budgetId, input, output, money, t, intl }: {
  reportId: string; householdId: string; budgetId: string; input: PlanInput; output: PlanOutput;
} & Ctx) {
  const budget = await getBudget(householdId, new Date(`${input.month}-01T00:00:00Z`));
  const locked = budget?.id !== budgetId ? t("Budget not found.") : budget.status === "VALIDATED" ? t("Switch the budget back to draft to apply.") : null;
  const proposed = new Map(output.lines.map((l) => [l.budgetItemId, l]));
  const avg = (h: number[]) => Math.round(h.reduce((s, x) => s + x, 0) / h.length);
  return (
    <>
      <div className="stat-group">
        <Stat label={t("Income")} value={money(input.income)} />
        <Stat label={t("Fixed charges")} value={money(input.fixed)} />
        <Stat label={t("Desired savings")} value={money(input.savings)} />
        <Stat label={t("To allocate")} value={money(input.toDistribute)} tone="pos" note={t("Income − fixed − savings")} />
      </div>
      <Card variant="table">
        <SectionHeader title={`${t("Proposed allocation")} · ${monthLabel(new Date(`${input.month}-01`), intl)}`} subtitle={t("Average of the last 3 months of actual spending as a reference.")} />
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t("Line")}</th>
                <th className="num hidden md:table-cell">{t("3-month avg.")}</th>
                <th className="num hidden sm:table-cell">{t("Currently planned")}</th>
                <th className="num">{t("Proposed")}</th>
                <th className="hidden lg:table-cell">{t("Why")}</th>
              </tr>
            </thead>
            <tbody>
              {input.lines.map((l) => (
                <tr key={l.id}>
                  <td className="break-words">{l.label}<small className="block text-label font-medium text-faint lg:hidden">{proposed.get(l.id)?.reason}</small></td>
                  <td className="num hidden text-muted md:table-cell">{money(avg(l.history))}</td>
                  <td className="num hidden text-muted sm:table-cell">{money(l.planned)}</td>
                  <td className="num font-bold text-heading">{money(proposed.get(l.id)?.amount ?? 0)}</td>
                  <td className="hidden text-muted lg:table-cell">{proposed.get(l.id)?.reason}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-bold text-heading">
                <td>{t("Total")}</td>
                <td className="num hidden md:table-cell">{money(input.lines.reduce((s, l) => s + avg(l.history), 0))}</td>
                <td className="num hidden sm:table-cell">{money(input.lines.reduce((s, l) => s + l.planned, 0))}</td>
                <td className="num">{money(output.lines.reduce((s, l) => s + l.amount, 0))}</td>
                <td className="hidden lg:table-cell" />
              </tr>
            </tfoot>
          </table>
        </div>
        <ActionForm action={applyPlanAction} className="form px-3 pb-3">
          <input type="hidden" name="reportId" value={reportId} />
          <button type="submit" disabled={!!locked} aria-describedby={locked ? "plan-locked" : undefined} className="self-start">{t("Apply to the budget")}</button>
          {locked && <p id="plan-locked" className="m-0 text-label text-muted">{locked}</p>}
        </ActionForm>
      </Card>
      <Points title={t("Recommendation")} items={output.advice ? [output.advice] : []} kind="advice" />
    </>
  );
}
