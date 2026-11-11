import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listCategories } from "@/lib/categories";
import { todayIn } from "@/lib/ledger";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { LoanForm } from "../loan-form";
import { getI18n } from "@/lib/i18n-server";

export default async function NewLoanPage() {
  const user = await requireUser();
  const { t } = await getI18n();
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/loans" className="text-[inherit] no-underline hover:underline">Foyra / {t("Loans")}</Link>}
        title={t("New loan")}
        subtitle={t("The amortization schedule and payments are computed from these terms.")}
        actions={<Link href="/loans" className="button ghost"><Icon name="chevronLeft" className="size-4" />{t("Loans")}</Link>}
      />
      <Card className="max-w-3xl">
        <LoanForm categories={await listCategories(user.householdId)} firstDue={todayIn(user.household.timezone)} />
      </Card>
    </>
  );
}
