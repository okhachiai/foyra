import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { formatMonth } from "@/lib/budget";
import { listCategories } from "@/lib/categories";
import { dateFmt, NotFoundError, parseDay, todayIn } from "@/lib/ledger";
import { getI18n } from "@/lib/i18n-server";
import { getLoan } from "@/lib/loans";
import { formatCents } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { DateTile } from "@/components/ui/date-tile";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { ProgressBar } from "@/components/ui/progress";
import { Stat } from "@/components/ui/stat";
import { deleteLoanAction, prepayLoanAction } from "@/app/actions";
import { ActionForm, Field } from "@/app/form";
import { duration, LoanForm, monthYear, rateLabel } from "../loan-form";

export default async function LoanPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { t, intl } = await getI18n();
  const frDay = (d: Date) => dateFmt({ dateStyle: "short" }, intl).format(d);
  const todayStr = todayIn(user.household.timezone);
  const today = parseDay(todayStr)!;
  const loan = await getLoan(user.householdId, (await params).id, today).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const c = loan.fixedCharge;
  const categories = await listCategories(user.householdId);
  const money = (cents: number) => formatCents(cents, user.household.currency, intl);
  const { rows } = loan.schedule;
  const paid = new Map(c.payments.map((p) => [p.month.getTime(), p]));
  const next = rows.find((r) => r.due >= today);
  const left = rows.filter((r) => r.due >= today).length;
  const repaid = loan.principal - loan.status.balance;

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/loans" className="text-[inherit] no-underline hover:underline">Foyra / {t("Loans")}</Link>}
        title={c.name}
        subtitle={rows.length ? `${t("Planned end {date}", { date: monthYear(rows.at(-1)!.month, intl) })} · ${t(left > 1 ? "{n} payments left" : "{n} payment left", { n: left })}` : t("No payments")}
        actions={
          <>
            <Link href="/loans" className="button ghost"><Icon name="chevronLeft" className="size-4" />{t("Loans")}</Link>
            <a href="#prepay" className="button secondary">{t("Early repayment")}</a>
          </>
        }
      />

      <div className="dash-kpis">
        <Card variant="hero" className="kpi-card">
          <div className="kpi-top">
            <span className="kpi-icon hero"><Icon name="bank" className="size-4" /></span>
            <span className="kpi-title">{t("Principal still owed on {date}", { date: frDay(today) })}</span>
          </div>
          <strong className="kpi-value">{money(loan.status.balance)}</strong>
          <ProgressBar value={repaid} max={loan.principal} label={t("Principal repaid")} />
          <span className="kpi-note">{t("{paid} repaid of {total}", { paid: money(repaid), total: money(loan.principal) })}</span>
        </Card>
        <Stat label={t("Monthly payment")} value={next ? money(next.total) : "—"} note={next ? t("Next on {date}", { date: frDay(next.due) }) + (loan.insurance > 0 ? ` · ${t("including insurance {amount}", { amount: money(loan.insurance) })}` : "") : t("Loan paid off")} />
        <Stat label={t("Annual rate")} value={rateLabel(loan.annualRate, intl)} note={loan.annualRate ? t("Interest paid {amount}", { amount: money(loan.status.interestPaid) }) : t("Interest-free loan")} />
        <Stat label={t("Time left")} value={duration(left, t)} note={loan.annualRate ? t("Interest remaining {amount}", { amount: money(loan.status.interestRemaining) }) : t("{n} payments in total", { n: rows.length })} />
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <Card variant="table" className="lg:col-span-8 lg:self-start">
          <SectionHeader title={t("Amortization schedule")} subtitle={`${t("{n} payments in total", { n: rows.length })} · ${t("status from recorded payments")}`} />
          <div className="table-wrap table-tall">
            <table className="table">
              <thead>
                <tr>
                  <th className="hidden sm:table-cell">#</th>
                  <th>{t("Date")}</th>
                  <th className="num">{t("Payment")}</th>
                  <th className="num hidden md:table-cell">{t("Interest")}</th>
                  <th className="num">{t("Still owed")}</th>
                  <th>{t("Status")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isPaid = paid.has(r.month.getTime());
                  const isNext = r === next;
                  return (
                    <tr key={r.n} aria-current={isNext ? "step" : undefined} className={isNext ? "is-next" : undefined}>
                      <td className="hidden text-muted sm:table-cell">{r.n}</td>
                      <td className="whitespace-nowrap">{frDay(r.due)}</td>
                      <td className="num">{money(r.total)}</td>
                      <td className="num hidden text-muted md:table-cell">{money(r.interest)}</td>
                      <td className="num font-bold text-heading">{money(r.balance)}</td>
                      <td>
                        <Link href={`/charges?m=${formatMonth(r.month)}`} className="no-underline" aria-label={t(isPaid ? "Payment of {date}: paid, see the month’s charges" : "Payment of {date}: to pay, see the month’s charges", { date: frDay(r.due) })}>
                          <Badge dot tone={isPaid ? "success" : r.due < today ? "danger" : "muted"}>{t(isPaid ? "Paid" : r.due < today ? "To pay" : "Upcoming")}</Badge>
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="flex flex-col gap-4 lg:col-span-4">
          <Card id="prepay">
            <SectionHeader title={t("Early repayment")} subtitle={t("Creates the expense on {name}: deleting that expense cancels the repayment.", { name: c.name })} />
            <ActionForm action={prepayLoanAction}>
              <input type="hidden" name="id" value={loan.id} />
              <input type="hidden" name="idempotencyKey" value={crypto.randomUUID()} />
              <Field name="amount" label={t("Amount")}>
                <input name="amount" inputMode="decimal" required placeholder="0.00" autoComplete="off" />
              </Field>
              <Field name="occurredOn" label={t("Date")}>
                <input name="occurredOn" type="date" required defaultValue={todayStr} />
              </Field>
              <Field name="mode" label={t("Effect")}>
                <select name="mode" defaultValue="REDUCE_TERM">
                  <option value="REDUCE_TERM">{t("Shorten the term (same monthly payment)")}</option>
                  <option value="REDUCE_PAYMENT">{t("Lower the monthly payment (same end date)")}</option>
                </select>
              </Field>
              <button type="submit">{t("Record the repayment")}</button>
            </ActionForm>
          </Card>

          <Card>
            <SectionHeader title={t("Early repayments")} subtitle={loan.prepayments.length ? t("{n} recorded", { n: loan.prepayments.length }) : undefined} />
            {loan.prepayments.length === 0 ? (
              <p className="m-0 text-label text-muted">{t("No early repayments.")}</p>
            ) : (
              <ul className="due-list">
                {loan.prepayments.map((p) => (
                  <li key={p.id}>
                    <Link href={`/transactions/${p.transaction.id}`}>
                      <DateTile date={p.transaction.occurredOn} />
                      <span className="min-w-0 flex-1">
                        <b className="block truncate text-heading">{t(p.mode === "REDUCE_TERM" ? "Shorter term" : "Lower monthly payment")}</b>
                        <small className="block text-label text-faint">{frDay(p.transaction.occurredOn)} · {t("see the expense")}</small>
                      </span>
                      <b className="ab-num shrink-0 text-heading">{money(p.transaction.amount)}</b>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <SectionHeader title={t("Terms")} />
            <dl className="facts-list">
              <div><dt>{t("Amount borrowed")}</dt><dd>{money(loan.principal)}</dd></div>
              <div><dt>{t("First payment")}</dt><dd>{frDay(loan.firstDue)}</dd></div>
              {loan.insurance > 0 && <div><dt>{t("Monthly insurance")}</dt><dd>{money(loan.insurance)}</dd></div>}
              <div><dt>{t("Interest paid")}</dt><dd>{money(loan.status.interestPaid)}</dd></div>
              <div><dt>{t("Interest remaining")}</dt><dd>{money(loan.status.interestRemaining)}</dd></div>
              <div><dt>{t("End")}</dt><dd>{rows.length ? monthYear(rows.at(-1)!.month, intl) : "—"}</dd></div>
            </dl>
          </Card>
        </div>
      </div>

      <details className="card mt-4 p-5 sm:p-6">
        <summary className="m-0">{t("Edit the loan")}</summary>
        <LoanForm loan={loan} categories={categories} firstDue="" />
      </details>

      <Card className="danger-card mt-4">
        <SectionHeader title={t("Delete the loan")} subtitle={t("Payments already made and early repayments are kept as expenses.")} />
        <ActionForm action={deleteLoanAction} confirm={t("Delete this loan? Payments already made and early repayments are kept as expenses.")}>
          <input type="hidden" name="id" value={loan.id} />
          <div className="form-actions"><button type="submit" className="danger">{t("Delete the loan")}</button></div>
        </ActionForm>
      </Card>
    </>
  );
}
