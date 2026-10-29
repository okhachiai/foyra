import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { canWrite, getScope } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { listCategories } from "@/lib/categories";
import { getCharge } from "@/lib/charges";
import { NotFoundError, writableAccounts } from "@/lib/ledger";
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
  if (!canWrite(scope, charge.accountId)) {
    return (
      <>
        <p><Link href="/charges">← Charges fixes</Link></p>
        <h1>{charge.name}</h1>
        <p className="muted">Accès en lecture seule sur le compte de cette charge : elle ne peut pas être modifiée.</p>
      </>
    );
  }
  const [accounts, categories] = await Promise.all([
    // Le compte actuel reste affiché même archivé : l'enregistrement demandera d'en choisir un autre.
    writableAccounts(scope, charge.accountId),
    listCategories(user.householdId),
  ]);

  return (
    <>
      <p><Link href="/charges">← Charges fixes</Link></p>
      <h1>{charge.name}</h1>
      <ChargeForm charge={charge} accounts={accounts} categories={categories} startMonth="" />
      <ActionForm
        action={deleteChargeAction} className="danger-zone"
        confirm="Supprimer cette charge ? Les dépenses déjà payées sont conservées (elles deviennent variables)."
      >
        <input type="hidden" name="id" value={charge.id} />
        <p className="muted">Pour arrêter la charge sans perdre son suivi, renseignez plutôt son dernier mois.</p>
        <button type="submit" className="danger">Supprimer</button>
      </ActionForm>
    </>
  );
}
