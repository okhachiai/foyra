import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { listCategories } from "@/lib/categories";
import { getCharge } from "@/lib/charges";
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/lib/ledger";
import { deleteChargeAction } from "../../actions";
import { ActionForm } from "../../form";
import { ChargeForm } from "../charge-form";

export default async function EditChargePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const charge = await getCharge(user.householdId, (await params).id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  if (charge.loan) redirect(`/credits/${charge.loan.id}`);
  const [accounts, categories] = await Promise.all([
    // Le compte actuel reste affiché même archivé : l'enregistrement demandera d'en choisir un autre.
    prisma.account.findMany({
      where: { householdId: user.householdId, OR: [{ archivedAt: null }, { id: charge.accountId }] },
      orderBy: { createdAt: "asc" },
    }),
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
