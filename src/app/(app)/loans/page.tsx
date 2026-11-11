import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { parseDay, todayIn } from "@/lib/ledger";
import { listLoans } from "@/lib/loans";
import { formatCents } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { ProgressBar } from "@/components/ui/progress";
import { duration, monthYear, rateLabel } from "./loan-form";
import { getI18n } from "@/lib/i18n-server";
import { dateFmt } from "@/lib/ledger";

export default async function LoansPage() {
  const user = await requireUser();
  const { t, intl } = await getI18n();
  const today = parseDay(todayIn(user.household.timezone))!;
  const loans = await listLoans(user.householdId, today);
  const money = (cents: number) => formatCents(cents, user.household.currency, intl);

  return (
    <>
      <PageHeader
        eyebrow={`Foyra / ${t("Loans")}`}
        title={t("Loans")}
        subtitle={t("Principal still owed, monthly payments and progress of each loan.")}
        actions={<Link href="/loans/new" className="button"><Icon name="plus" className="size-4" />{t("Add a loan")}</Link>}
      />
      {loans.length === 0 ? (
        <EmptyState title={t("No loans")} action={<Link href="/loans/new">{t("Add a loan")}</Link>}>{t("Recorded loans and their amortization schedule will appear here.")}</EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {loans.map((l) => {
            const rows = l.schedule.rows;
            const next = rows.find((r) => r.due >= today);
            const left = rows.filter((r) => r.due >= today).length;
            const repaid = l.principal - l.status.balance;
            return (
              <Card key={l.id}>
                <SectionHeader
                  title={<Link href={`/loans/${l.id}`} className="text-heading no-underline hover:underline">{l.fixedCharge.name}</Link>}
                  subtitle={rows.length > 0 ? t("Ends {date}", { date: monthYear(rows.at(-1)!.month, intl) }) : undefined}
                  action={next ? <Badge dot tone="info">{t("Ongoing")}</Badge> : <Badge dot tone="success">{t("Paid off")}</Badge>}
                />
                <div>
                  <span className="text-label font-semibold text-muted">{t("Principal still owed")}</span>
                  <strong className="kpi-value block text-heading">{money(l.status.balance)}</strong>
                </div>
                <div className="flex flex-col gap-1.5">
                  <ProgressBar value={repaid} max={l.principal} label={t("Repayment of {name}", { name: l.fixedCharge.name })} />
                  <span className="text-label text-faint">{t("{paid} repaid of {total}", { paid: money(repaid), total: money(l.principal) })}</span>
                </div>
                <dl className="loan-facts">
                  <div><dt>{t("Monthly payment")}</dt><dd className="ab-num">{next ? money(next.total) : "—"}</dd></div>
                  <div><dt>{t("Rate")}</dt><dd className="ab-num">{l.annualRate ? rateLabel(l.annualRate, intl) : t("Interest-free")}</dd></div>
                  <div><dt>{t("Time left")}</dt><dd>{duration(left, t)}</dd></div>
                </dl>
                <div className="card-foot">
                  <span className="text-label text-muted">{next ? t("Next payment on {date}", { date: dateFmt({ day: "numeric", month: "short" }, intl).format(next.due) }) : t("All payments are past")}</span>
                  <Link href={`/loans/${l.id}`} className="tap-link text-label font-bold" aria-label={t("Details of {name}", { name: l.fixedCharge.name })}>{t("Details")}</Link>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
