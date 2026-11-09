import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listCategories } from "@/lib/categories";
import { todayIn } from "@/lib/ledger";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { LoanForm } from "../loan-form";

export default async function NewLoanPage() {
  const user = await requireUser();
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/credits" className="text-[inherit] no-underline hover:underline">Foyra / Crédits</Link>}
        title="Nouveau crédit"
        subtitle="Le tableau d’amortissement et les échéances sont calculés à partir de ces conditions."
        actions={<Link href="/credits" className="button ghost"><Icon name="chevronLeft" className="size-4" />Crédits</Link>}
      />
      <Card className="max-w-3xl">
        <LoanForm categories={await listCategories(user.householdId)} firstDue={todayIn(user.household.timezone)} />
      </Card>
    </>
  );
}
