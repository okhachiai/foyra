import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listCategories } from "@/lib/categories";
import { todayIn } from "@/lib/ledger";
import { LoanForm } from "../loan-form";

export default async function NewLoanPage() {
  const user = await requireUser();
  return (
    <>
      <p><Link href="/credits">← Crédits</Link></p>
      <h1>Nouveau crédit</h1>
      <LoanForm categories={await listCategories(user.householdId)} firstDue={todayIn(user.household.timezone)} />
    </>
  );
}
