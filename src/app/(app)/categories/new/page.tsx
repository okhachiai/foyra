import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { CategoryForm, KIND_LABELS } from "../category-form";

export default async function NewCategoryPage({ searchParams }: { searchParams: Promise<{ kind?: string; parent?: string }> }) {
  const user = await requireAdmin();
  const { kind, parent: parentId } = await searchParams;
  if (parentId) {
    const parent = await prisma.category.findFirst({ where: { id: parentId, householdId: user.householdId, parentId: null, archivedAt: null } });
    if (!parent) notFound();
    return (
      <>
        <h1>Nouvelle sous-catégorie · {parent.name}</h1>
        <CategoryForm kind={parent.kind} parentId={parent.id} />
      </>
    );
  }
  if (kind !== "INCOME" && kind !== "EXPENSE") notFound();
  return (
    <>
      <h1>Nouvelle catégorie · {KIND_LABELS[kind]}</h1>
      <CategoryForm kind={kind} />
    </>
  );
}
