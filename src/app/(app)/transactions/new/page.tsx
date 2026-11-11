import { requireUser } from "@/lib/auth";
import { listCategories } from "@/lib/categories";
import { payers, todayIn } from "@/lib/ledger";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { EntryForm } from "../entry-form";
import { getI18n } from "@/lib/i18n-server";

type Params = { kind?: string; cat?: string; d?: string; shared?: string; back?: string };

/** New transaction; pre-filled from a budget line (`kind`, `cat`, `d`, `shared`, `back=budget`); `back=dashboard`: back to the dashboard. */
export default async function NewTransactionPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requireUser();
  const q = await searchParams;
  const { t } = await getI18n();
  const [members, categories] = await Promise.all([payers(user.householdId), listCategories(user.householdId)]);
  // Starting values only: the action re-validates everything (household category, date, direction).
  const v = {
    occurredOn: /^\d{4}-\d{2}-\d{2}$/.test(q.d ?? "") ? q.d! : todayIn(user.household.timezone),
    paidById: user.id,
    kind: q.kind === "INCOME" ? ("INCOME" as const) : ("EXPENSE" as const),
    categoryId: q.cat,
    shared: q.shared === "1",
  };
  const back = q.back === "budget" || q.back === "dashboard" ? q.back : undefined;
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/transactions" className="text-[inherit] no-underline hover:underline">Foyra / {t("Transactions")}</Link>}
        title={t("New transaction")}
        subtitle={t("An actual household expense or income.")}
        actions={<Link href={back === "budget" ? "/budget" : back === "dashboard" ? "/dashboard" : "/transactions"} className="button ghost"><Icon name="chevronLeft" className="size-4" />{t("Back")}</Link>}
      />
      <Card className="max-w-3xl">
        <EntryForm members={members} categories={categories} v={v} back={back} />
      </Card>
    </>
  );
}
