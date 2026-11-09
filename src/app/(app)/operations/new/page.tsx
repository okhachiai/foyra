import { requireUser } from "@/lib/auth";
import { listCategories } from "@/lib/categories";
import { payers, todayIn } from "@/lib/ledger";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { EntryForm } from "../entry-form";

type Params = { kind?: string; cat?: string; d?: string; shared?: string; back?: string };

/** Nouvelle opération ; pré-remplie depuis une ligne du budget (`kind`, `cat`, `d`, `shared`, `back=budget`) ; `back=dashboard` : retour au tableau de bord. */
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
  const back = q.back === "budget" || q.back === "dashboard" ? q.back : undefined;
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/operations" className="text-[inherit] no-underline hover:underline">Foyra / Opérations</Link>}
        title="Nouvelle opération"
        subtitle="Dépense ou recette réelle du foyer."
        actions={<Link href={back === "budget" ? "/budget" : back === "dashboard" ? "/tableau-de-bord" : "/operations"} className="button ghost"><Icon name="chevronLeft" className="size-4" />Retour</Link>}
      />
      <Card className="max-w-3xl">
        <EntryForm members={members} categories={categories} v={v} back={back} />
      </Card>
    </>
  );
}
