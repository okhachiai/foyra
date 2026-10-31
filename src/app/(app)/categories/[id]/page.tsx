import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getCategory } from "@/lib/categories";
import { NotFoundError } from "@/lib/ledger";
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

  return (
    <>
      <p><Link href="/categories">← Catégories</Link></p>
      <h1>{category.parent ? `${category.parent.name} › ${category.name}` : category.name}</h1>
      <p className="muted">{KIND_LABELS[category.kind]}{archived && " · archivée"}</p>
      <CategoryForm category={category} />
      {!category.parent && !archived && (
        <p><Link href={`/categories/new?parent=${category.id}`} className="button secondary">Ajouter une sous-catégorie</Link></p>
      )}
      <ActionForm
        action={archiveCategoryAction} className="danger-zone"
        confirm={archived ? undefined : "Archiver cette catégorie ? Elle disparaît des nouveaux budgets et des nouvelles saisies ; l’historique est conservé."}
      >
        <input type="hidden" name="id" value={category.id} />
        <input type="hidden" name="restore" value={archived ? "1" : "0"} />
        {!archived && category._count.children > 0 && <p className="muted">Ses sous-catégories seront archivées aussi.</p>}
        <button type="submit" className={archived ? "secondary" : "danger"}>{archived ? "Réactiver" : "Archiver"}</button>
      </ActionForm>
      <ActionForm
        action={deleteCategoryAction} className="danger-zone"
        confirm={`Supprimer définitivement cette catégorie${category._count.children ? " et ses sous-catégories" : ""} ? Les opérations et budgets concernés sont conservés, sans catégorie.`}
      >
        <input type="hidden" name="id" value={category.id} />
        <p className="muted">Pour la retirer sans perdre le classement de l’historique, archivez-la plutôt.</p>
        <button type="submit" className="danger">Supprimer</button>
      </ActionForm>
    </>
  );
}
