import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listCategories } from "@/lib/categories";
import { todayIn } from "@/lib/ledger";
import { ChargeForm } from "../charge-form";

export default async function NewChargePage() {
  const user = await requireUser();
  return (
    <>
      <p><Link href="/charges">← Récurrences</Link></p>
      <h1>Nouvelle récurrence</h1>
      <ChargeForm categories={await listCategories(user.householdId)} startMonth={todayIn(user.household.timezone).slice(0, 7)} />
    </>
  );
}
