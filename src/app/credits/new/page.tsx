import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listCategories } from "@/lib/categories";
import { prisma } from "@/lib/db";
import { todayIn } from "@/lib/ledger";
import { LoanForm } from "../loan-form";

export default async function NewLoanPage() {
  const user = await requireUser();
  const [accounts, categories] = await Promise.all([
    prisma.account.findMany({ where: { householdId: user.householdId, archivedAt: null }, orderBy: { createdAt: "asc" } }),
    listCategories(user.householdId),
  ]);
  return (
    <>
      <p><Link href="/credits">← Crédits</Link></p>
      <h1>Nouveau crédit</h1>
      {accounts.length === 0 ? (
        <p className="muted">Créez d’abord un compte.</p>
      ) : (
        <LoanForm accounts={accounts} categories={categories} firstDue={todayIn(user.household.timezone)} />
      )}
    </>
  );
}
