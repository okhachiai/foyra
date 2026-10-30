import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { listCategories } from "@/lib/categories";
import { prisma } from "@/lib/db";
import { formatDay, payers } from "@/lib/ledger";
import { deleteTransactionAction } from "../../actions";
import { ActionForm } from "../../form";
import { EntryForm } from "../entry-form";

export default async function EditOperationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const t = await prisma.transaction.findFirst({ where: { id: (await params).id, householdId: user.householdId } });
  if (!t) notFound();
  const [members, categories] = await Promise.all([payers(user.householdId, t.paidById), listCategories(user.householdId)]);
  const v = {
    id: t.id, kind: t.kind, amount: t.amount, occurredOn: formatDay(t.occurredOn), note: t.note, categoryId: t.categoryId, paidById: t.paidById, shared: t.shared,
  };
  return (
    <>
      <h1>Modifier l’opération</h1>
      <EntryForm members={members} categories={categories} v={v} />
      <ActionForm action={deleteTransactionAction} className="danger-zone" confirm="Supprimer définitivement cette opération ?">
        <input type="hidden" name="id" value={t.id} />
        <button type="submit" className="danger">Supprimer</button>
      </ActionForm>
    </>
  );
}
