import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { addMonths } from "@/lib/amortization";
import { formatMonth, parseMonth } from "@/lib/budget";
import { getCalendar, type ChargeStatus } from "@/lib/calendar";
import { dateFmt, formatDay, monthLabel, parseDay, todayIn } from "@/lib/ledger";
import { getI18n } from "@/lib/i18n-server";
import { formatCents } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { DateTile } from "@/components/ui/date-tile";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { MonthNav } from "@/components/ui/month-nav";
import { PageHeader } from "@/components/ui/page-header";
import { PayCharge } from "../charges/pay-form";

/** Shared colour codes (dashboard, charges): paid green, to pay amber, late coral. */
const STATUS: Record<ChargeStatus, ["success" | "warning" | "danger", string]> = { paid: ["success", "Paid"], due: ["warning", "To pay"], late: ["danger", "Late"] };

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const user = await requireUser();
  const { t, intl } = await getI18n();
  const dayLabel = (d: Date) => dateFmt({ weekday: "long", day: "numeric", month: "long" }, intl).format(d);
  const shortDay = (d: Date) => dateFmt({ dateStyle: "short" }, intl).format(d);
  // Monday first; 3 Jan 2000 was a Monday.
  const weekdays = Array.from({ length: 7 }, (_, i) => dateFmt({ weekday: "short" }, intl).format(Date.UTC(2000, 0, 3 + i)));
  const plural = (n: number, one: string, many: string) => t(n > 1 ? many : one, { n });
  const todayStr = todayIn(user.household.timezone);
  const today = parseDay(todayStr)!;
  const month = parseMonth((await searchParams).m) ?? parseMonth(todayStr.slice(0, 7))!;
  const { days, upcoming, forecast } = await getCalendar(user.householdId, month, today);
  const money = (cents: number) => formatCents(cents, user.household.currency, intl);
  const current = todayStr.startsWith(formatMonth(month));

  // Month grid: weeks from Monday to Sunday, empty cells before the 1st.
  const byDay = new Map(days.map((d) => [formatDay(d.day), d]));
  const count = Math.round((addMonths(month, 1).getTime() - month.getTime()) / 86_400_000);
  const lead = (month.getUTCDay() + 6) % 7;
  const cells = [...Array<null>(lead).fill(null), ...Array.from({ length: count }, (_, i) => new Date(month.getTime() + i * 86_400_000))];

  return (
    <>
      <PageHeader
        eyebrow={`Foyra / ${t("Calendar")}`}
        title={t("Calendar")}
        subtitle={t("Payments and transactions for {month}.", { month: monthLabel(month, intl) })}
        actions={
          <>
            {!current && <Link href="/calendar" className="button ghost">{t("Today")}</Link>}
            <MonthNav path="/calendar" month={month} />
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-8">
          <SectionHeader
            title={<span className="capitalize">{monthLabel(month, intl)}</span>}
            subtitle={days.length ? plural(days.length, "{n} day with activity", "{n} days with activity") : t("Nothing planned this month")}
          />
          <div className="cal" role="table" aria-label={t("Calendar for {month}", { month: monthLabel(month, intl) })}>
            <div className="cal-row" role="row">
              {weekdays.map((w) => <span key={w} role="columnheader" className="cal-head">{w}</span>)}
            </div>
            {Array.from({ length: Math.ceil(cells.length / 7) }, (_, w) => (
              <div key={w} className="cal-row" role="row">
                {Array.from({ length: 7 }, (_, i) => {
                  const d = cells[w * 7 + i];
                  if (!d) return <span key={i} role="cell" className="cal-cell is-out" />;
                  const k = formatDay(d);
                  const e = byDay.get(k);
                  const isToday = k === todayStr;
                  const dots = [
                    ...(e?.charges.map((c) => `dot-${c.status}`) ?? []),
                    ...(e?.transactions.map((x) => (x.kind === "INCOME" ? "dot-income" : "dot-expense")) ?? []),
                  ];
                  const summary = e && [e.charges.length && plural(e.charges.length, "{n} payment", "{n} payments"), e.transactions.length && plural(e.transactions.length, "{n} transaction", "{n} transactions")].filter(Boolean).join(", ");
                  const body = (
                    <>
                      <span className="cal-num">{d.getUTCDate()}</span>
                      {dots.length > 0 && (
                        <span className="cal-dots" aria-hidden>
                          {dots.slice(0, 4).map((c, j) => <i key={j} className={c} />)}
                          {dots.length > 4 && <small>+{dots.length - 4}</small>}
                        </span>
                      )}
                      {e && <span className="cal-first">{e.charges[0]?.name ?? (e.transactions[0].note || e.transactions[0].category?.name || t(e.transactions[0].kind === "INCOME" ? "Income" : "Expense"))}</span>}
                    </>
                  );
                  return (
                    <span key={i} role="cell" className={`cal-cell${isToday ? " is-today" : ""}`} aria-current={isToday ? "date" : undefined}>
                      {e ? <a href={`#d-${k}`} aria-label={`${dayLabel(d)}: ${summary}`}>{body}</a> : <span>{body}</span>}
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="ab-legend">
            <span><i className="dot-paid" />{t("Payment made")}</span>
            <span><i className="dot-due" />{t("To pay")}</span>
            <span><i className="dot-late" />{t("Late")}</span>
            <span><i className="dot-income" />{t("Income")}</span>
            <span><i className="dot-expense" />{t("Expense")}</span>
          </div>
        </Card>

        <div className="flex flex-col gap-4 lg:col-span-4">
          <Card>
            <SectionHeader title={t("Upcoming payments")} subtitle={t("Next 7 days and late payments of the current month")} />
            {upcoming.length === 0 ? (
              <EmptyState title={t("No payments due in the next 7 days")} />
            ) : (
              <ul className="due-list">
                {upcoming.map((c) => (
                  <li key={`${c.id}-${formatDay(c.due)}`} className={c.status === "late" ? "is-late" : undefined}>
                    <Link href={c.loanId ? `/loans/${c.loanId}` : `/charges/${c.id}`}>
                      <DateTile date={c.due} />
                      <span className="min-w-0 flex-1">
                        <b className="block truncate text-heading">{c.name}</b>
                        <small className="block truncate text-label text-faint">{t(c.loanId ? "Loan" : "Fixed charge")} · {shortDay(c.due)}</small>
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
          </Card>

          {forecast && (
            <Card>
              <SectionHeader title={t("End-of-month forecast")} subtitle={t("Net of the month’s transactions, minus unpaid payments")} />
              <dl className="facts-list">
                <div><dt>{t("Month net")}</dt><dd className={forecast.net < 0 ? "text-neg" : undefined}>{money(forecast.net)}</dd></div>
                <div><dt>{t("Payments to make")}</dt><dd>{money(forecast.unpaid ? -forecast.unpaid : 0)}</dd></div>
                <div className="is-total"><dt>{t("End of month")}</dt><dd className={forecast.end < 0 ? "text-neg" : "text-pos"}>{money(forecast.end)}</dd></div>
              </dl>
            </Card>
          )}
        </div>
      </div>

      <section className="mt-8" aria-labelledby="agenda">
        <h2 id="agenda" className="mt-0">{t("Day by day")}</h2>
        {days.length === 0 && <EmptyState title={t("Nothing planned this month")} />}
        <div className="flex flex-col gap-3">
          {days.map(({ day, charges, transactions }) => {
            const k = formatDay(day);
            const isToday = k === todayStr;
            return (
              <Card key={k} id={`d-${k}`} className={`agenda-day${isToday ? " is-today" : ""}`} aria-current={isToday ? "date" : undefined}>
                <SectionHeader title={<span className="capitalize">{dayLabel(day)}</span>} action={isToday && <Badge>{t("Today")}</Badge>} />
                <ul className="due-list">
                  {charges.map((c) => {
                    const paid = c.payment?.transaction;
                    const [tone, label] = STATUS[c.status];
                    return (
                      <li key={c.id} className={c.status === "late" ? "is-late" : undefined}>
                        <div className="due-row">
                          <span className="row-icon info" title={t("Payment")}><Icon name="calendar" className="size-4" /></span>
                          <span className="min-w-0 flex-1">
                            <Link href={c.loanId ? `/loans/${c.loanId}` : `/charges/${c.id}`} className="block truncate font-bold text-heading no-underline hover:underline">{c.name}</Link>
                            <small className="block text-label text-faint">{t(c.loanId ? "Loan payment" : "Payment")}</small>
                          </span>
                          <span className="flex shrink-0 flex-col items-end gap-1">
                            <b className="ab-num text-heading">{money(c.amount)}</b>
                            <Badge dot tone={tone}>{t(label)}</Badge>
                          </span>
                        </div>
                        {paid ? (
                          <p className="due-meta">{t("Paid {amount} on {date}", { amount: money(paid.amount), date: shortDay(paid.occurredOn) })} · <Link href={`/transactions/${paid.id}`}>{t("see the expense")}</Link></p>
                        ) : (
                          <div className="due-meta"><PayCharge id={c.id} month={month} amount={c.amount} due={c.due} back="calendar" late={c.status === "late"} /></div>
                        )}
                      </li>
                    );
                  })}
                  {transactions.map((x) => {
                    const credit = x.kind === "INCOME";
                    const cat = x.category && `${x.category.parent ? `${x.category.parent.name} › ` : ""}${x.category.name}`;
                    const label = t(credit ? "Income" : "Expense");
                    return (
                      <li key={x.id}>
                        <Link href={`/transactions/${x.id}`}>
                          <span className={`row-icon ${credit ? "" : "expense"}`} title={label}><Icon name={credit ? "arrowIn" : "arrowOut"} className="size-4" /></span>
                          <span className="min-w-0 flex-1">
                            <b className="block truncate text-heading">{x.note || cat || label}</b>
                            <small className="block truncate text-label text-faint">{[x.note || cat ? label : null, x.paidBy.name].filter(Boolean).join(" · ")}</small>
                          </span>
                          <b className={`ab-num shrink-0 ${credit ? "text-pos" : "text-neg"}`}>{credit ? "+" : "−"}{money(x.amount)}</b>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            );
          })}
        </div>
      </section>
    </>
  );
}
