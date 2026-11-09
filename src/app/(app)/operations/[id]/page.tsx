import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { listCategories } from "@/lib/categories";
import { prisma } from "@/lib/db";
import { formatDay, payers } from "@/lib/ledger";
import { deleteTransactionAction } from "@/app/actions";
import { ActionForm } from "@/app/form";
import Link from "next/link";
import { Card, SectionHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
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
      <PageHeader
        eyebrow={<Link href="/operations" className="text-[inherit] no-underline hover:underline">Foyra / Opérations</Link>}
        title="Modifier l’opération"
        actions={<Link href="/operations" className="button ghost"><Icon name="chevronLeft" className="size-4" />Opérations</Link>}
      />
      <div className="grid max-w-3xl gap-4">
        <Card><EntryForm members={members} categories={categories} v={v} /></Card>
        <Card className="danger-card">
          <SectionHeader title="Supprimer l’opération" subtitle="Elle disparaît du suivi et des totaux du mois. Action définitive." />
          <ActionForm action={deleteTransactionAction} confirm="Supprimer définitivement cette opération ?">
            <input type="hidden" name="id" value={t.id} />
            <div className="form-actions"><button type="submit" className="danger">Supprimer</button></div>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
