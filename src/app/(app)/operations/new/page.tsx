import { requireUser } from "@/lib/auth";
import { listCategories } from "@/lib/categories";
import { payers, todayIn } from "@/lib/ledger";
import { EntryForm } from "../entry-form";

type Params = { kind?: string; cat?: string; d?: string; shared?: string; back?: string };

/** Nouvelle opération ; pré-remplie depuis une ligne du budget (`kind`, `cat`, `d`, `shared`, `back=budget`). */
export default async function NewOperationPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requireUser();
  const q = await searchParams;
  const [members, categories] = await Promise.all([payers(user.householdId), listCategories(user.householdId)]);
  // Valeurs de départ seulement : l'action revalide tout (catégorie du foyer, date, sens).
  const v = {
    occurredOn: /^\d{4}-\d{2}-\d{2}$/.test(q.d ?? "") ? q.d! : todayIn(user.household.timezone),
    paidById: user.id,
    kind: q.kind === "INCOME" ? ("INCOME" as const) : ("EXPENSE" as const),
    categoryId: q.cat,
    shared: q.shared === "1",
  };
  return (
    <>
      <h1>Nouvelle opération</h1>
      <EntryForm members={members} categories={categories} v={v} back={q.back === "budget" ? "budget" : undefined} />
    </>
  );
}
