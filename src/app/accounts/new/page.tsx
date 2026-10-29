import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AccountForm } from "../account-form";

export default async function NewAccountPage() {
  const user = await requireUser();
  // Seul l'admin peut attribuer le compte à un autre membre.
  const members = user.role === "ADMIN"
    ? await prisma.user.findMany({ where: { householdId: user.householdId, disabledAt: null }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } })
    : [{ id: user.id, name: user.name }];
  return (
    <>
      <h1>Nouveau compte</h1>
      <AccountForm members={members} canSetOwner userId={user.id} />
    </>
  );
}
