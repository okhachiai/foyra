import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getCategory } from "@/lib/categories";
import { NotFoundError } from "@/lib/ledger";
import { deleteCategoryAction } from "../../actions";
import { ActionForm } from "../../form";
import { CategoryForm, KIND_LABELS } from "../category-form";

export default async function EditCategoryPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const category = await getCategory(user.householdId, (await params).id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });

  return (
    <>
      <p><Link href="/categories">← Catégories</Link></p>
      <h1>{category.parent ? `${category.parent.name} › ${category.name}` : category.name}</h1>
      <p className="muted">{KIND_LABELS[category.kind]}</p>
      <CategoryForm category={category} />
      {!category.parent && (
        <p><Link href={`/categories/new?parent=${category.id}`} className="button secondary">Ajouter une sous-catégorie</Link></p>
      )}
      <ActionForm action={deleteCategoryAction} className="danger-zone" confirm="Supprimer cette catégorie ? Ses opérations passeront « Sans catégorie ».">
        <input type="hidden" name="id" value={category.id} />
        {category._count.children > 0 && <p className="muted">Supprimez d’abord ses sous-catégories.</p>}
        <button type="submit" className="danger" disabled={category._count.children > 0}>Supprimer</button>
      </ActionForm>
    </>
  );
}
