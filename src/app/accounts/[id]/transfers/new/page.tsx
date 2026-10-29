import { notFound } from "next/navigation";
import { getScope } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { todayIn, writableAccounts } from "@/lib/ledger";
import { loadAccount } from "../../load";
import { TransferForm } from "../../tx-forms";

export default async function NewTransferPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const scope = await getScope(user);
  const account = await loadAccount(scope, (await params).id, "WRITE");
  if (account.archivedAt) notFound();
  const accounts = await writableAccounts(scope);
  return (
    <>
      <h1>Nouveau virement</h1>
      {accounts.length < 2 ? (
        <p className="muted">Il faut au moins deux comptes actifs modifiables pour faire un virement.</p>
      ) : (
        <TransferForm accounts={accounts} from={account.id} returnTo={account.id} v={{ occurredOn: todayIn(user.household.timezone) }} />
      )}
    </>
  );
}
