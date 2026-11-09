import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getCategory } from "@/lib/categories";
import { NotFoundError } from "@/lib/ledger";
import { Badge } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { archiveCategoryAction, deleteCategoryAction } from "@/app/actions";
import { ActionForm } from "@/app/form";
import { CategoryForm, KIND_LABELS } from "../category-form";

export default async function EditCategoryPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const category = await getCategory(admin.householdId, (await params).id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const archived = category.archivedAt !== null;
  const children = category._count.children;

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/categories" className="text-[inherit] no-underline hover:underline">Paramètres / Catégories</Link>}
        title={category.parent ? `${category.parent.name} › ${category.name}` : category.name}
        subtitle={<>{KIND_LABELS[category.kind]} {archived && <Badge tone="warning">archivée</Badge>}</>}
        actions={
          <>
            <Link href="/categories" className="button ghost"><Icon name="chevronLeft" className="size-4" />Catégories</Link>
            {!category.parent && !archived && (
              <Link href={`/categories/new?parent=${category.id}`} className="button secondary"><Icon name="plus" className="size-4" />Sous-catégorie</Link>
            )}
          </>
        }
      />

      <div className="grid max-w-3xl gap-4">
        <Card>
          <SectionHeader title="Réglages" />
          <CategoryForm category={category} />
        </Card>

        <Card className="danger-card">
          <SectionHeader title="Zone sensible" subtitle="Pour la retirer sans perdre le classement de l’historique, archivez-la plutôt que de la supprimer." />
          <div className="flex flex-wrap gap-2">
            <ActionForm
              action={archiveCategoryAction} className="inline"
              confirm={archived ? undefined : `Archiver cette catégorie${children ? " et ses sous-catégories" : ""} ? Elle disparaît des nouveaux budgets et des nouvelles saisies ; l’historique est conservé.`}
            >
              <input type="hidden" name="id" value={category.id} />
              <input type="hidden" name="restore" value={archived ? "1" : "0"} />
              <button type="submit" className="secondary">{archived ? "Réactiver" : "Archiver"}</button>
            </ActionForm>
            <ActionForm
              action={deleteCategoryAction} className="inline"
              confirm={`Supprimer définitivement cette catégorie${children ? " et ses sous-catégories" : ""} ? Les opérations et budgets concernés sont conservés, sans catégorie.`}
            >
              <input type="hidden" name="id" value={category.id} />
              <button type="submit" className="danger">Supprimer</button>
            </ActionForm>
          </div>
        </Card>
      </div>
    </>
  );
}
