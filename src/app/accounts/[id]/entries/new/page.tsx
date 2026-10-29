import { notFound } from "next/navigation";
import { getScope } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { listCategories } from "@/lib/categories";
import { todayIn } from "@/lib/ledger";
import { loadAccount } from "../../load";
import { EntryForm } from "../../tx-forms";

export default async function NewEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const account = await loadAccount(await getScope(user), (await params).id, "WRITE");
  if (account.archivedAt) notFound();
  return (
    <>
      <h1>Nouvelle opération · {account.name}</h1>
      <EntryForm accountId={account.id} categories={await listCategories(user.householdId)} v={{ occurredOn: todayIn(user.household.timezone) }} />
    </>
  );
}
