import { notFound } from "next/navigation";
import { canManage, getScope } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { loadAccount } from "../load";
import { AccountForm } from "../../account-form";

export default async function EditAccountPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const scope = await getScope(user);
  const account = await loadAccount(scope, (await params).id, "MANAGE");
  if (account.archivedAt) notFound();
  const members = await prisma.user.findMany({ where: { householdId: user.householdId, OR: [{ disabledAt: null }, ...(account.ownerId ? [{ id: account.ownerId }] : [])] }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } });
  return (
    <>
      <h1>Modifier « {account.name} »</h1>
      <AccountForm account={account} members={members} canSetOwner={user.role === "ADMIN" || canManage(scope, account.id)} userId={user.id} />
    </>
  );
}
