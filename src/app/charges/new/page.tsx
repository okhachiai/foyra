import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listCategories } from "@/lib/categories";
import { prisma } from "@/lib/db";
import { todayIn } from "@/lib/ledger";
import { ChargeForm } from "../charge-form";

export default async function NewChargePage() {
  const user = await requireUser();
  const [accounts, categories] = await Promise.all([
    prisma.account.findMany({ where: { householdId: user.householdId, archivedAt: null }, orderBy: { createdAt: "asc" } }),
    listCategories(user.householdId),
  ]);
  return (
    <>
      <p><Link href="/charges">← Charges fixes</Link></p>
      <h1>Nouvelle charge fixe</h1>
      {accounts.length === 0 ? (
        <p className="muted">Créez d’abord un compte.</p>
      ) : (
        <ChargeForm accounts={accounts} categories={categories} startMonth={todayIn(user.household.timezone).slice(0, 7)} />
      )}
    </>
  );
}
