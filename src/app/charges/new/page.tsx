import Link from "next/link";
import { getScope } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { listCategories } from "@/lib/categories";
import { todayIn, writableAccounts } from "@/lib/ledger";
import { ChargeForm } from "../charge-form";

export default async function NewChargePage() {
  const user = await requireUser();
  const [accounts, categories] = await Promise.all([
    writableAccounts(await getScope(user)),
    listCategories(user.householdId),
  ]);
  return (
    <>
      <p><Link href="/charges">← Récurrences</Link></p>
      <h1>Nouvelle récurrence</h1>
      {accounts.length === 0 ? (
        <p className="muted">Créez d’abord un compte (ou demandez l’accès en écriture à un compte).</p>
      ) : (
        <ChargeForm accounts={accounts} categories={categories} startMonth={todayIn(user.household.timezone).slice(0, 7)} />
      )}
    </>
  );
}
