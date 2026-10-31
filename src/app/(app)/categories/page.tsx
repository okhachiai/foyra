import Link from "next/link";
import type { Category, CategoryKind } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { listCategories } from "@/lib/categories";
import { Badge } from "@/components/ui/badge";
import { addDefaultCategoriesAction } from "@/app/actions";
import { ActionForm } from "@/app/form";
import { SettingsNav } from "@/app/nav";
import { KIND_LABELS } from "./category-form";

export default async function CategoriesPage() {
  const user = await requireUser();
  const admin = user.role === "ADMIN";
  const categories = await listCategories(user.householdId, { withArchived: true });

  const content = (c: Category, label: string, parent?: Category) => (
    <>
      <span>
        {label}
        <span className="mt-1 flex flex-wrap gap-1">
          {(c.archivedAt || parent?.archivedAt) && <Badge tone="warning">archivée</Badge>}
          {(!c.enabled || parent?.enabled === false) && <Badge tone="muted">hors calcul</Badge>}
          {!c.recurring && <Badge tone="muted">non reprise</Badge>}
          {!c.isTemplate && <Badge tone="muted">hors modèle</Badge>}
        </span>
      </span>
    </>
  );
  const row = (c: Category, label: string, parent?: Category) => (
    <li key={c.id}>{admin ? <Link href={`/categories/${c.id}`}>{content(c, label, parent)}</Link> : <div>{content(c, label, parent)}</div>}</li>
  );

  return (
    <>
      <h1>Catégories</h1>
      <SettingsNav admin={admin} />
      <p className="muted">
        Catalogue et modèles du budget : inclusion, reprise et ordre. Les montants se saisissent dans le budget du mois. Modifier une catégorie ne change jamais un budget déjà créé.
        {!admin && " Seuls les administrateurs peuvent modifier le catalogue."}
      </p>
      {admin && (
        <ActionForm action={addDefaultCategoriesAction} className="mb-4">
          <button type="submit" className="secondary self-start">{categories.length ? "Ajouter les modèles manquants" : "Créer les modèles de catégories"}</button>
        </ActionForm>
      )}
      {(["INCOME", "EXPENSE"] as CategoryKind[]).map((kind) => (
        <section key={kind}>
          <div className="row">
            <h2>{KIND_LABELS[kind]}</h2>
            {admin && <Link href={`/categories/new?kind=${kind}`} className="button secondary">Ajouter</Link>}
          </div>
          {!categories.some((c) => c.kind === kind) && <p className="muted">Aucune catégorie.</p>}
          {(kind === "EXPENSE" ? [["Charges fixes", true], ["Charges variables", false]] as const : [[null, null]] as const).map(([title, fixed]) => {
            const list = categories.filter((c) => c.kind === kind && (fixed === null || c.fixed === fixed));
            return (
              <div key={String(fixed)}>
                {title && list.length > 0 && <h3>{title}</h3>}
                <ul className="list">
                  {list.flatMap((c) => [
                    row(c, c.name),
                    ...c.children.map((s) => row(s, `${c.name} › ${s.name}`, c)),
                  ])}
                </ul>
              </div>
            );
          })}
        </section>
      ))}
    </>
  );
}
