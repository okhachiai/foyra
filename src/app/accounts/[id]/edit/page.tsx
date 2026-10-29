import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { loadAccount } from "../load";
import { AccountForm } from "../../account-form";

export default async function EditAccountPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const account = await loadAccount(user.householdId, (await params).id);
  if (account.archivedAt) notFound();
  return (
    <>
      <h1>Modifier « {account.name} »</h1>
      <AccountForm account={account} />
    </>
  );
}
