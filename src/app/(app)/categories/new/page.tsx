import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { CategoryForm, KIND_LABELS } from "../category-form";

export default async function NewCategoryPage({ searchParams }: { searchParams: Promise<{ kind?: string; parent?: string }> }) {
  const user = await requireAdmin();
  const { kind, parent: parentId } = await searchParams;
  const parent = parentId
    ? await prisma.category.findFirst({ where: { id: parentId, householdId: user.householdId, parentId: null, archivedAt: null } })
    : null;
  if (parentId && !parent) notFound();
  if (!parent && kind !== "INCOME" && kind !== "EXPENSE") notFound();
  const back = parent ? `/categories/${parent.id}` : "/categories";

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/categories" className="text-[inherit] no-underline hover:underline">Paramètres / Catégories</Link>}
        title={parent ? "Nouvelle sous-catégorie" : "Nouvelle catégorie"}
        subtitle={parent ? `${KIND_LABELS[parent.kind]} › ${parent.name}` : KIND_LABELS[kind as "INCOME" | "EXPENSE"]}
        actions={<Link href={back} className="button ghost"><Icon name="chevronLeft" className="size-4" />Retour</Link>}
      />
      <Card className="max-w-3xl">
        {parent ? <CategoryForm kind={parent.kind} parentId={parent.id} /> : <CategoryForm kind={kind as "INCOME" | "EXPENSE"} />}
      </Card>
    </>
  );
}
