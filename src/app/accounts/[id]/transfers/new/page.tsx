import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { todayIn } from "@/lib/ledger";
import { loadAccount } from "../../load";
import { TransferForm } from "../../tx-forms";

export default async function NewTransferPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const account = await loadAccount(user.householdId, (await params).id);
  if (account.archivedAt) notFound();
  const accounts = await prisma.account.findMany({ where: { householdId: user.householdId, archivedAt: null }, orderBy: { createdAt: "asc" } });
  return (
    <>
      <h1>Nouveau virement</h1>
      {accounts.length < 2 ? (
        <p className="muted">Il faut au moins deux comptes actifs pour faire un virement.</p>
      ) : (
        <TransferForm accounts={accounts} from={account.id} returnTo={account.id} v={{ occurredOn: todayIn(user.household.timezone) }} />
      )}
    </>
  );
}
