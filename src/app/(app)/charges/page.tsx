import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { parseMonth } from "@/lib/budget";
import { chargeStatus } from "@/lib/calendar";
import { listMonthCharges } from "@/lib/charges";
import { dateFmt, monthLabel, parseDay, todayIn } from "@/lib/ledger";
import { getI18n } from "@/lib/i18n-server";
import { formatCents } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { DateTile } from "@/components/ui/date-tile";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { MonthNav } from "@/components/ui/month-nav";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { SettingsNav } from "@/app/nav";
import { PayCharge } from "./pay-form";

const STATUS = { paid: ["success", "Paid"], due: ["warning", "To pay"], late: ["danger", "Late"] } as const;

export default async function ChargesPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const user = await requireUser();
  const { t, intl } = await getI18n();
  const shortDay = (d: Date) => dateFmt({ dateStyle: "short" }, intl).format(d);
  const todayStr = todayIn(user.household.timezone);
  const today = parseDay(todayStr)!;
  const month = parseMonth((await searchParams).m) ?? parseMonth(todayStr.slice(0, 7))!;
  const [list, inactive] = await Promise.all([
    listMonthCharges(user.householdId, month),
    prisma.fixedCharge.findMany({ where: { householdId: user.householdId, active: false }, orderBy: { name: "asc" } }),
  ]);
  const charges = list.map((c) => ({ ...c, status: chargeStatus(c, today) }));
  const money = (cents: number) => formatCents(cents, user.household.currency, intl);
  const sum = (unpaidOnly = false) => charges.reduce((s, c) => s + (unpaidOnly && c.payment ? 0 : c.amount), 0);
  const late = charges.filter((c) => c.status === "late");
  const paidCount = charges.filter((c) => c.payment).length;

  return (
    <>
      <PageHeader
        eyebrow={`${t("Settings")} / ${t("Recurring")}`}
        title={t("Recurring charges")}
        subtitle={t("Payments for {month}. Indicative: nothing is paid automatically.", { month: monthLabel(month, intl) })}
        actions={
          <>
            <MonthNav path="/charges" month={month} />
            <Link href="/charges/new" className="button"><Icon name="plus" className="size-4" />{t("Add")}</Link>
          </>
        }
      />
      <SettingsNav admin={user.role === "ADMIN"} />

      <div className="mb-4 stat-group">
        <Stat label={t("Recurring spending this month")} value={money(sum())} note={t("Amounts read from the month’s budget")} />
        <Stat label={t("Left to pay")} value={money(sum(true))} tone={sum(true) > 0 ? "neg" : undefined} note={t(charges.length - paidCount > 1 ? "{n} unpaid payments" : "{n} unpaid payment", { n: charges.length - paidCount })} />
        <Stat label={t("Paid")} value={`${paidCount} / ${charges.length}`} tone="pos" note={t("Actual transactions recorded")} />
      </div>

      {late.length > 0 && (
        <div role="alert" className="alert danger mb-4">
          <Icon name="alert" className="size-5 shrink-0" />
          <p className="m-0">
            <b>{t(late.length > 1 ? "{n} late payments" : "{n} late payment", { n: late.length })}</b> · {money(late.reduce((s, c) => s + c.amount, 0))}
            <span className="block text-label">{late.map((c) => c.name).join(", ")}</span>
          </p>
        </div>
      )}

      <Card>
        <SectionHeader title={t("Payments")} subtitle={t("“Mark paid” records the actual transaction. Amount: the budget line with the same category.")} />
        {charges.length === 0 ? (
          <EmptyState title={t("No active recurring charge for this month")} action={<Link href="/charges/new">{t("Add a recurring charge")}</Link>} />
        ) : (
          <ul className="due-list">
            {charges.map((c) => {
              const paid = c.payment?.transaction;
              const [tone, label] = STATUS[c.status];
              return (
                <li key={c.id} className={c.status === "late" ? "is-late" : undefined}>
                  <div className="due-row">
                    <DateTile date={c.due} />
                    <span className="min-w-0 flex-1">
                      <Link href={`/charges/${c.id}`} className="block truncate font-bold text-heading no-underline hover:underline">{c.name}</Link>
                      <small className="block truncate text-label text-faint">
                        {c.category.parent ? `${c.category.parent.name} › ` : ""}{c.category.name}
                        {c.loanId && ` · ${t("loan")}`}
                      </small>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      {c.budgeted ? <b className="ab-num text-heading">{money(c.amount)}</b> : <small className="text-label text-faint">{t("Not in the budget")}</small>}
                      <Badge dot tone={tone}>{t(label)}</Badge>
                    </span>
                  </div>
                  {paid ? (
                    <p className="due-meta">
                      {t("Paid {amount} on {date}", { amount: money(paid.amount), date: shortDay(paid.occurredOn) })} · <Link href={`/transactions/${paid.id}`}>{t("see the transaction")}</Link>
                    </p>
                  ) : (
                    <div className="due-meta"><PayCharge id={c.id} month={month} amount={c.amount} due={c.due} late={c.status === "late"} /></div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {inactive.length > 0 && (
        <details>
          <summary>{t("Disabled recurring charges ({n})", { n: inactive.length })}</summary>
          <ul className="list">
            {inactive.map((c) => (
              <li key={c.id}>
                <Link href={`/charges/${c.id}`}><span>{c.name}<small className="muted">{t("On the {day}", { day: c.dueDay })}</small></span><Icon name="chevron" className="size-4" /></Link>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
