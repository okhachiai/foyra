import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { listCategories } from "@/lib/categories";
import { getCharge } from "@/lib/charges";
import { NotFoundError } from "@/lib/ledger";
import { deleteChargeAction } from "@/app/actions";
import { ActionForm } from "@/app/form";
import { Card, SectionHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { ChargeForm } from "../charge-form";

export default async function EditChargePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const charge = await getCharge(user.householdId, (await params).id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  if (charge.loan) redirect(`/credits/${charge.loan.id}`);
  const categories = await listCategories(user.householdId);

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/charges" className="text-[inherit] no-underline hover:underline">Paramètres / Récurrences</Link>}
        title={charge.name}
        actions={<Link href="/charges" className="button ghost"><Icon name="chevronLeft" className="size-4" />Récurrences</Link>}
      />
      <div className="grid max-w-3xl gap-4">
        <Card><ChargeForm charge={charge} categories={categories} startMonth="" /></Card>
        <Card className="danger-card">
          <SectionHeader title="Supprimer la récurrence" subtitle="Pour l’arrêter sans perdre son suivi, désactivez-la ou renseignez son dernier mois." />
          <ActionForm action={deleteChargeAction} confirm="Supprimer cette récurrence ? Les opérations déjà enregistrées sont conservées.">
            <input type="hidden" name="id" value={charge.id} />
            <div className="form-actions"><button type="submit" className="danger">Supprimer</button></div>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
