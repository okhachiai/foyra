import Link from "next/link";
import { getScope } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { listCategories } from "@/lib/categories";
import { todayIn, writableAccounts } from "@/lib/ledger";
import { LoanForm } from "../loan-form";

export default async function NewLoanPage() {
  const user = await requireUser();
  const [accounts, categories] = await Promise.all([
    writableAccounts(await getScope(user)),
    listCategories(user.householdId),
  ]);
  return (
    <>
      <p><Link href="/credits">← Crédits</Link></p>
      <h1>Nouveau crédit</h1>
      {accounts.length === 0 ? (
        <p className="muted">Créez d’abord un compte (ou demandez l’accès en écriture à un compte).</p>
      ) : (
        <LoanForm accounts={accounts} categories={categories} firstDue={todayIn(user.household.timezone)} />
      )}
    </>
  );
}
