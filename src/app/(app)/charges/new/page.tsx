import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listCategories } from "@/lib/categories";
import { todayIn } from "@/lib/ledger";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { ChargeForm } from "../charge-form";
import { getI18n } from "@/lib/i18n-server";

export default async function NewChargePage() {
  const user = await requireUser();
  const { t } = await getI18n();
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/charges" className="text-[inherit] no-underline hover:underline">{t("Settings")} / {t("Recurring")}</Link>}
        title={t("New recurring charge")}
        subtitle={t("Indicative monthly payment: nothing is paid automatically.")}
        actions={<Link href="/charges" className="button ghost"><Icon name="chevronLeft" className="size-4" />{t("Recurring")}</Link>}
      />
      <Card className="max-w-3xl">
        <ChargeForm categories={await listCategories(user.householdId)} startMonth={todayIn(user.household.timezone).slice(0, 7)} />
      </Card>
    </>
  );
}
