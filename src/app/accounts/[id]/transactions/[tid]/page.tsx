import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { listCategories } from "@/lib/categories";
import { prisma } from "@/lib/db";
import { formatDay, getTransfer } from "@/lib/ledger";
import { deleteTransactionAction } from "../../../../actions";
import { ActionForm } from "../../../../form";
import { loadAccount } from "../../load";
import { EntryForm, TransferForm } from "../../tx-forms";

export default async function EditTransactionPage({ params }: { params: Promise<{ id: string; tid: string }> }) {
  const user = await requireUser();
  const { id, tid } = await params;
  const account = await loadAccount(user.householdId, id);
  const t = await prisma.transaction.findFirst({ where: { id: tid, householdId: user.householdId, accountId: account.id } });
  if (!t || account.archivedAt) notFound();
  const v = { id: t.id, amount: t.amount, occurredOn: formatDay(t.occurredOn), note: t.note, categoryId: t.categoryId };

  let form;
  if (t.transferId) {
    const transfer = await getTransfer(user.householdId, t.transferId);
    const accounts = await prisma.account.findMany({ where: { householdId: user.householdId, archivedAt: null }, orderBy: { createdAt: "asc" } });
    const active = (id: string) => accounts.some((a) => a.id === id);
    // L'autre côté est sur un compte archivé : virement en lecture seule.
    if (!active(transfer.out.accountId) || !active(transfer.in.accountId)) {
      return (
        <>
          <h1>Virement</h1>
          <p className="muted">L’un des deux comptes de ce virement est archivé : il ne peut plus être modifié ni supprimé.</p>
        </>
      );
    }
    form = <TransferForm accounts={accounts} from={transfer.out.accountId} to={transfer.in.accountId} returnTo={account.id} v={v} />;
  } else {
    form = <EntryForm accountId={account.id} kind={t.kind as "INCOME" | "EXPENSE"} categories={await listCategories(user.householdId)} v={v} />;
  }

  return (
    <>
      <h1>{t.transferId ? "Modifier le virement" : "Modifier l’opération"}</h1>
      {t.transferId && <p className="muted">Les deux côtés du virement seront modifiés ensemble.</p>}
      {form}
      <ActionForm action={deleteTransactionAction} className="danger-zone" confirm="Supprimer définitivement cette opération ?">
        <input type="hidden" name="id" value={t.id} />
        <input type="hidden" name="returnTo" value={account.id} />
        <button type="submit" className="danger">{t.transferId ? "Supprimer le virement (les deux côtés)" : "Supprimer"}</button>
      </ActionForm>
    </>
  );
}
