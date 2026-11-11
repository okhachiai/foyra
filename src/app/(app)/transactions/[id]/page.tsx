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
import { getI18n } from "@/lib/i18n-server";

export default async function EditTransactionPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { t: tr } = await getI18n();
  const t = await prisma.transaction.findFirst({ where: { id: (await params).id, householdId: user.householdId } });
  if (!t) notFound();
  const [members, categories] = await Promise.all([payers(user.householdId, t.paidById), listCategories(user.householdId)]);
  const v = {
    id: t.id, kind: t.kind, amount: t.amount, occurredOn: formatDay(t.occurredOn), note: t.note, categoryId: t.categoryId, paidById: t.paidById, shared: t.shared,
  };
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/transactions" className="text-[inherit] no-underline hover:underline">Foyra / {tr("Transactions")}</Link>}
        title={tr("Edit the transaction")}
        actions={<Link href="/transactions" className="button ghost"><Icon name="chevronLeft" className="size-4" />{tr("Transactions")}</Link>}
      />
      <div className="grid max-w-3xl gap-4">
        <Card><EntryForm members={members} categories={categories} v={v} /></Card>
        <Card className="danger-card">
          <SectionHeader title={tr("Delete the transaction")} subtitle={tr("It disappears from tracking and the month’s totals. This cannot be undone.")} />
          <ActionForm action={deleteTransactionAction} confirm={tr("Permanently delete this transaction?")}>
            <input type="hidden" name="id" value={t.id} />
            <div className="form-actions"><button type="submit" className="danger">{tr("Delete")}</button></div>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
