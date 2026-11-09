import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listCategories } from "@/lib/categories";
import { todayIn } from "@/lib/ledger";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { ChargeForm } from "../charge-form";

export default async function NewChargePage() {
  const user = await requireUser();
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/charges" className="text-[inherit] no-underline hover:underline">Paramètres / Récurrences</Link>}
        title="Nouvelle récurrence"
        subtitle="Échéance mensuelle indicative : rien n’est payé automatiquement."
        actions={<Link href="/charges" className="button ghost"><Icon name="chevronLeft" className="size-4" />Récurrences</Link>}
      />
      <Card className="max-w-3xl">
        <ChargeForm categories={await listCategories(user.householdId)} startMonth={todayIn(user.household.timezone).slice(0, 7)} />
      </Card>
    </>
  );
}
