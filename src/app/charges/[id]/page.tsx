import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getScope } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { listCategories } from "@/lib/categories";
import { getCharge } from "@/lib/charges";
import { NotFoundError } from "@/lib/ledger";
import { deleteChargeAction } from "../../actions";
import { ActionForm } from "../../form";
import { ChargeForm } from "../charge-form";

export default async function EditChargePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const scope = await getScope(user);
  const charge = await getCharge(scope, (await params).id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  if (charge.loan) redirect(`/credits/${charge.loan.id}`);
  const categories = await listCategories(user.householdId);

  return (
    <>
      <p><Link href="/charges">← Récurrences</Link></p>
      <h1>{charge.name}</h1>
      <ChargeForm charge={charge} categories={categories} startMonth="" />
      <ActionForm
        action={deleteChargeAction} className="danger-zone"
        confirm="Supprimer cette récurrence ? Les opérations déjà enregistrées sont conservées."
      >
        <input type="hidden" name="id" value={charge.id} />
        <p className="muted">Pour l’arrêter sans perdre son suivi, désactivez-la ou renseignez son dernier mois.</p>
        <button type="submit" className="danger">Supprimer</button>
      </ActionForm>
    </>
  );
}
