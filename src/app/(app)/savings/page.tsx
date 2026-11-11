import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { formatMonth, parseMonth } from "@/lib/budget";
import { dateFmt, payers, todayIn } from "@/lib/ledger";
import { getI18n } from "@/lib/i18n-server";
import type { T } from "@/lib/i18n";
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

const monthLabel = (key: string, intl: string) => dateFmt({ month: "long", year: "numeric" }, intl).format(new Date(`${key}-01T00:00:00Z`));
const shortMonth = (key: string, intl: string) => dateFmt({ month: "short" }, intl).format(new Date(`${key}-01T00:00:00Z`));

/** Monthly bars: paid in (filled) in front of planned (outline). HTML/CSS, readable at any width. */
function MonthBars({ series, money, t, intl }: { series: SavingsMonth[]; money: (c: number) => string; t: T; intl: string }) {
  const max = Math.max(1, ...series.flatMap((s) => [s.actual, s.planned]));
  const h = (v: number) => `${(v / max) * 100}%`;
  return (
    <div className="flex min-h-48 flex-1 items-end gap-1 sm:gap-2" role="img" aria-label={t("Savings paid in and planned per month (details in the tracking table)")}>
      {series.map((s) => (
        <div key={s.month} className="flex h-full min-w-0 flex-1 flex-col items-center gap-1" title={`${monthLabel(s.month, intl)} · ${t("paid in {amount}", { amount: money(s.actual) })} · ${t("planned {amount}", { amount: money(s.planned) })}`}>
          <div className="relative w-full flex-1">
            {s.planned > 0 && <div className="absolute inset-x-0 bottom-0 rounded-t-[var(--r-xs)] border border-dashed border-accent" style={{ height: h(s.planned) }} />}
            <div className="absolute inset-x-1 bottom-0 rounded-t-[var(--r-xs)] bg-accent" style={{ height: h(s.actual) }} />
          </div>
          <span className="text-micro text-faint">{shortMonth(s.month, intl)}</span>
        </div>
      ))}
    </div>
  );
}

/** Running-total curve; stretched to the width (stroke not distorted). */
function CumulativeLine({ series, t, intl }: { series: SavingsMonth[]; t: T; intl: string }) {
  const max = Math.max(1, ...series.map((s) => s.cumulative)), n = series.length;
  const pts = series.map((s, i) => `${n === 1 ? 50 : (i / (n - 1)) * 100},${100 - (s.cumulative / max) * 95}`);
  return (
    <>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-40 w-full" role="img" aria-label={t("Cumulative savings over 12 months (details in the tracking table)")}>
        <polygon points={`0,100 ${pts.join(" ")} 100,100`} fill="var(--chart-1)" opacity={0.12} />
        <polyline points={pts.join(" ")} fill="none" stroke="var(--chart-1)" strokeWidth={2.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      <div className="flex justify-between text-label text-faint"><span>{monthLabel(series[0].month, intl)}</span><span>{monthLabel(series[n - 1].month, intl)}</span></div>
    </>
  );
}

/** Savings: deposits (expenses in the savings category, deducted from income) and tracking over the last 12 months. */
export default async function SavingsPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const user = await requireUser();
  const { t, intl } = await getI18n();
  const todayStr = todayIn(user.household.timezone);
  const month = parseMonth((await searchParams).m) ?? parseMonth(todayStr.slice(0, 7))!;
  const [{ series, recent }, members] = await Promise.all([getSavings(user.householdId, month), payers(user.householdId)]);
  const money = (cents: number) => formatCents(cents, user.household.currency, intl);
  const cur = series[series.length - 1];
  const average = Math.round(series.reduce((s, m) => s + m.actual, 0) / series.length);
  const left = Math.max(cur.planned - cur.actual, 0);
  // Suggested date: today for the current month, else the 1st of the shown month.
  const day = formatMonth(month) === todayStr.slice(0, 7) ? todayStr : `${formatMonth(month)}-01`;

  return (
    <>
      <PageHeader
        eyebrow={`Foyra / ${t("Savings")}`}
        title={t("Savings")}
        subtitle={`${t("Money set aside, deducted from income like a charge")} · ${monthLabel(cur.month, intl)}.`}
        actions={
          <>
            <MonthNav path="/savings" month={month} />
            <a href="#set-aside" className="button"><Icon name="plus" className="size-4" />{t("Set aside")}</a>
          </>
        }
      />

      <div className="dash-kpis">
        <Card variant="hero" className="kpi-card">
          <div className="kpi-top">
            <span className="kpi-icon hero"><Icon name="savings" className="size-4" /></span>
            <span className="kpi-title">{t("Saved this month")}</span>
          </div>
          <strong className="kpi-value">{money(cur.actual)}</strong>
          {cur.planned > 0 ? (
            <>
              <ProgressBar value={cur.actual} max={cur.planned} label={t("Savings paid in vs planned")} />
              <span className="kpi-note">{t("{pct}% of planned ({amount})", { pct: Math.round((cur.actual / cur.planned) * 100), amount: money(cur.planned) })}</span>
            </>
          ) : (
            <span className="kpi-note">{t("No “Savings” line in this month’s budget.")}</span>
          )}
        </Card>
        <div className="stat-group">
          <Stat label={t("Planned this month")} value={money(cur.planned)} note={cur.planned ? t("Left to pay in {amount}", { amount: money(left) }) : t("No “Savings” line in the budget")} />
          <Stat label={t("Total saved")} value={money(cur.cumulative)} tone="pos" note={t("Running total of all deposits")} />
          <Stat label={t("Monthly average")} value={money(average)} note={t("Over the last 12 months")} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-7">
          <SectionHeader
            title={t("Paid in and planned per month")}
            subtitle={t("Last 12 months")}
            action={
              <span className="ab-legend mt-0">
                <span><i className="bg-accent" />{t("Paid in")}</span>
                <span><i className="border border-dashed border-accent" />{t("Planned in the budget")}</span>
              </span>
            }
          />
          <MonthBars series={series} money={money} t={t} intl={intl} />
        </Card>

        <Card className="lg:col-span-5" id="set-aside">
          <SectionHeader title={t("Set aside")} subtitle={t("Recorded as a “Savings” expense (fixed charge): deducted from the month’s income.")} />
          <ActionForm action={addSavingAction}>
            <input type="hidden" name="idempotencyKey" value={crypto.randomUUID()} />
            <Field name="amount" label={t("Amount to save")}><input name="amount" inputMode="decimal" required placeholder="0.00" autoComplete="off" /></Field>
            <Field name="occurredOn" label={t("Date")}><input name="occurredOn" type="date" required defaultValue={day} /></Field>
            <Field name="note" label={t("Note (optional)")}><input name="note" maxLength={500} placeholder={t("Savings account, holiday fund…")} /></Field>
            <Field name="paidById" label={t("Paid in by")}>
              <select name="paidById" defaultValue={user.id}>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </Field>
            <SharedCheck label={t("Shared (split in proportion to income)")} checked />
            <button type="submit">{t("Set aside")}</button>
          </ActionForm>
        </Card>

        <Card className="lg:col-span-12">
          <SectionHeader title={t("Cumulative savings over time")} action={<b className="ab-num text-section text-heading">{money(cur.cumulative)}</b>} />
          <CumulativeLine series={series} t={t} intl={intl} />
        </Card>

        <Card variant="table" className="lg:col-span-7">
          <SectionHeader title={t("Monthly tracking")} subtitle={t("Planned in the budget vs paid in")} />
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("Month")}</th>
                  <th className="num">{t("Planned")}</th>
                  <th className="num">{t("Paid in")}</th>
                  <th className="num hidden sm:table-cell">{t("Gap")}</th>
                  <th className="num">{t("Running total")}</th>
                </tr>
              </thead>
              <tbody>
                {[...series].reverse().map((s) => {
                  const gap = s.actual - s.planned;
                  return (
                    <tr key={s.month}>
                      <td className="whitespace-nowrap"><Link href={`/savings?m=${s.month}`} aria-current={s.month === cur.month ? "page" : undefined}>{monthLabel(s.month, intl)}</Link></td>
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
          <SectionHeader title={t("Deposit history")} subtitle={t("Last 10 deposits")} />
          {recent.length === 0 ? (
            <EmptyState title={t("No deposits")} action={<a href="#set-aside">{t("Set aside")}</a>}>{t("Amounts set aside will appear here.")}</EmptyState>
          ) : (
            <ul className="due-list">
              {recent.map((r) => (
                <li key={r.id}>
                  <Link href={`/transactions/${r.id}`}>
                    <DateTile date={r.occurredOn} />
                    <span className="min-w-0 flex-1">
                      <b className="block truncate text-heading">{r.note || t("Savings")}</b>
                      <small className="block truncate text-label text-faint">{dateFmt({ dateStyle: "short" }, intl).format(r.occurredOn)} · {r.paidBy.name}</small>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <b className="ab-num text-heading">{money(r.amount)}</b>
                      <Badge dot tone={r.shared ? "success" : "muted"}>{t(r.shared ? "Shared" : "Personal")}</Badge>
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
