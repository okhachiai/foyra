import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { addMonths } from "@/lib/amortization";
import { formatMonth, parseMonth } from "@/lib/budget";
import { listCategories } from "@/lib/categories";
import { prisma } from "@/lib/db";
import { getI18n } from "@/lib/i18n-server";
import { dateFmt, monthLabel, monthNet, payers, todayIn } from "@/lib/ledger";
import { formatCents } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { MonthNav } from "@/components/ui/month-nav";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { Fold } from "../budget/fold";
import { EntryForm } from "./entry-form";

type Params = { m?: string; t?: string; c?: string };

/** A month's actual transactions (`?m=YYYY-MM`, current month by default), filterable by direction (`t`) and top-level category (`c`). */
export default async function TransactionsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requireUser();
  const { t, intl, locale } = await getI18n();
  const dayLabel = (d: Date) => dateFmt({ weekday: "short", day: "numeric", month: "short" }, intl).format(d);
  const q = await searchParams;
  const todayStr = todayIn(user.household.timezone);
  const month = parseMonth(q.m) ?? parseMonth(todayStr.slice(0, 7))!;
  const m = formatMonth(month);
  const [net, rows, members, categories] = await Promise.all([
    monthNet(user.householdId, month),
    prisma.transaction.findMany({
      where: { householdId: user.householdId, occurredOn: { gte: month, lt: addMonths(month, 1) } },
      orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      include: { paidBy: { select: { name: true } }, category: { select: { id: true, name: true, parentId: true, parent: { select: { name: true } } } } },
    }),
    payers(user.householdId),
    listCategories(user.householdId),
  ]);
  const money = (cents: number) => formatCents(cents, user.household.currency, intl);
  const sum = (kind: "INCOME" | "EXPENSE") => rows.reduce((s, r) => s + (r.kind === kind ? r.amount : 0), 0);

  // Filters: direction, then top-level category (a subcategory counts for its parent).
  const kind = q.t === "INCOME" || q.t === "EXPENSE" ? q.t : undefined;
  const topOf = (r: (typeof rows)[number]) => (r.category ? (r.category.parentId ?? r.category.id) : "none");
  const topName = new Map(rows.map((r) => [topOf(r), r.category ? (r.category.parent?.name ?? r.category.name) : t("Uncategorized")]));
  const cat = q.c && topName.has(q.c) ? q.c : undefined;
  const shown = rows.filter((r) => (!kind || r.kind === kind) && (!cat || topOf(r) === cat));
  const filtered = !!(kind || cat);
  const entryDay = todayStr.startsWith(m) ? todayStr : `${m}-01`;
  const count = (n: number) => t(n > 1 ? "{n} transactions" : "{n} transaction", { n });

  return (
    <>
      <PageHeader
        eyebrow={`Foyra / ${t("Transactions")}`}
        title={t("Transactions")}
        subtitle={t("Spending and income recorded in {month}.", { month: monthLabel(month, intl) })}
        actions={
          <>
            <MonthNav path="/transactions" month={month} />
            <Link href="/transactions/new" className="button"><Icon name="plus" className="size-4" />{t("Add")}</Link>
          </>
        }
      />

      <div className="mb-4 stat-group">
        <Stat label={t("Income")} value={money(sum("INCOME"))} tone="pos" />
        <Stat label={t("Spending")} value={money(sum("EXPENSE"))} tone="neg" />
        <Stat label={t("Month net")} value={money(net)} tone={net < 0 ? "neg" : undefined} note={t("Income − spending")} />
      </div>

      <Fold id="quick-entry" title={t("Quick entry")} className="mb-4">
        <EntryForm members={members} categories={categories} v={{ occurredOn: entryDay, paidById: user.id }} />
      </Fold>

      <Card variant="table">
        <SectionHeader
          className="flex-wrap"
          title={t("Transaction list")}
          subtitle={filtered ? t("{shown} of {total}", { shown: shown.length, total: count(rows.length) }) : count(rows.length)}
          action={
            rows.length > 0 && (
              <form method="get" className="filters" aria-label={t("Filter transactions")}>
                <input type="hidden" name="m" value={m} />
                <label className="sr-only" htmlFor="f-t">{t("Type")}</label>
                <select id="f-t" name="t" defaultValue={kind ?? ""}>
                  <option value="">{t("All types")}</option>
                  <option value="INCOME">{t("Income")}</option>
                  <option value="EXPENSE">{t("Spending")}</option>
                </select>
                <label className="sr-only" htmlFor="f-c">{t("Category")}</label>
                <select id="f-c" name="c" defaultValue={cat ?? ""}>
                  <option value="">{t("All categories")}</option>
                  {[...topName].sort((a, b) => a[1].localeCompare(b[1], locale)).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
                <button type="submit" className="secondary">{t("Filter")}</button>
                {filtered && <Link href={`/transactions?m=${m}`} className="tap-link text-label font-bold">{t("Clear")}</Link>}
              </form>
            )
          }
        />
        {shown.length === 0 ? (
          <EmptyState
            title={t(filtered ? "No transactions for these filters" : "No transactions this month")}
            action={filtered ? <Link href={`/transactions?m=${m}`}>{t("Clear filters")}</Link> : <Link href="/transactions/new">{t("Add a transaction")}</Link>}
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("Transaction")}</th>
                  <th className="hidden md:table-cell">{t("Date")}</th>
                  <th className="hidden lg:table-cell">{t("Paid by")}</th>
                  <th className="hidden sm:table-cell">{t("Split")}</th>
                  <th className="num">{t("Amount")}</th>
                  <th className="hidden sm:table-cell"><span className="sr-only">{t("Actions")}</span></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const income = r.kind === "INCOME";
                  const type = t(income ? "Income" : "Expense");
                  const catName = r.category && `${r.category.parent ? `${r.category.parent.name} › ` : ""}${r.category.name}`;
                  const title = r.note || catName || type;
                  return (
                    <tr key={r.id}>
                      <td className="w-full max-w-0">
                        <div className="flex items-center gap-3">
                          <span className={`row-icon ${income ? "" : "expense"}`} title={type}><Icon name={income ? "arrowIn" : "arrowOut"} className="size-4" /></span>
                          <span className="min-w-0">
                            <Link href={`/transactions/${r.id}`} className="block truncate text-heading no-underline hover:underline">{title}</Link>
                            <small className="block truncate text-label font-medium text-faint">
                              <span className="md:hidden">{dayLabel(r.occurredOn)} · </span>
                              {r.note ? (catName ?? t("Uncategorized")) : type}
                              <span className="lg:hidden"> · {r.paidBy.name}</span>
                            </small>
                          </span>
                        </div>
                      </td>
                      <td className="hidden whitespace-nowrap text-muted md:table-cell">{dayLabel(r.occurredOn)}</td>
                      <td className="hidden lg:table-cell">{r.paidBy.name}</td>
                      <td className="hidden sm:table-cell"><Badge dot tone={r.shared ? "success" : "muted"}>{t(r.shared ? "Shared" : "Personal")}</Badge></td>
                      <td className={`num font-bold ${income ? "text-pos" : "text-neg"}`}>{income ? "+" : "−"}{money(r.amount)}</td>
                      <td className="hidden w-px sm:table-cell">
                        <Link href={`/transactions/${r.id}`} className="icon-link" aria-label={t("Edit: {title}", { title })}><Icon name="chevron" className="size-4" /></Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
