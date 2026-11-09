import Link from "next/link";
import type { Category, CategoryKind } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { listCategories } from "@/lib/categories";
import { Badge } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { addDefaultCategoriesAction } from "@/app/actions";
import { ActionForm } from "@/app/form";
import { SettingsNav } from "@/app/nav";
import { KIND_LABELS } from "./category-form";

export default async function CategoriesPage() {
  const user = await requireUser();
  const admin = user.role === "ADMIN";
  const categories = await listCategories(user.householdId, { withArchived: true });

  // Sous-catégorie : en retrait sous sa parente, dont elle hérite archivage et exclusion.
  const row = (c: Category, parent?: Category) => {
    const body = (
      <>
        <span className={parent ? "flex items-center gap-2 pl-4 !font-medium" : undefined}>
          {parent && <span aria-hidden className="text-faint">↳</span>}
          {parent && <span className="sr-only">{parent.name} › </span>}
          {c.name}
        </span>
        <span className="flex flex-wrap items-center justify-end gap-1">
          {(c.archivedAt || parent?.archivedAt) && <Badge tone="warning">archivée</Badge>}
          {(!c.enabled || parent?.enabled === false) && <Badge tone="muted">hors calcul</Badge>}
          {!c.recurring && <Badge tone="muted">non reprise</Badge>}
          {!c.isTemplate && <Badge tone="muted">hors modèle</Badge>}
          {admin && <Icon name="chevron" className="size-4 text-faint" />}
        </span>
      </>
    );
    return <li key={c.id}>{admin ? <Link href={`/categories/${c.id}`}>{body}</Link> : <div>{body}</div>}</li>;
  };

  return (
    <>
      <PageHeader
        eyebrow="Paramètres" title="Catégories"
        subtitle={`Catalogue et modèles du budget : inclusion, reprise et ordre. Les montants se saisissent dans le budget du mois.${admin ? "" : " Seuls les administrateurs peuvent modifier le catalogue."}`}
        actions={admin && (
          <ActionForm action={addDefaultCategoriesAction} className="inline">
            <button type="submit" className="secondary">{categories.length ? "Ajouter les modèles manquants" : "Créer les modèles de catégories"}</button>
          </ActionForm>
        )}
      />
      <SettingsNav admin={admin} />

      <div className="grid items-start gap-4 xl:grid-cols-2">
        {(["INCOME", "EXPENSE"] as CategoryKind[]).map((kind) => {
          const ofKind = categories.filter((c) => c.kind === kind);
          const groups = kind === "EXPENSE" ? ([["Charges fixes", true], ["Charges variables", false]] as const) : ([[null, null]] as const);
          return (
            <Card key={kind} variant="table">
              <SectionHeader
                title={KIND_LABELS[kind]}
                subtitle={`${ofKind.length} catégorie${ofKind.length > 1 ? "s" : ""}`}
                action={admin && <Link href={`/categories/new?kind=${kind}`} className="button secondary"><Icon name="plus" className="size-4" />Ajouter</Link>}
              />
              {!ofKind.length && (
                <EmptyState title="Aucune catégorie" className="mb-3">
                  {admin ? "Ajoutez-en une ou créez les modèles de catégories." : "Un administrateur doit compléter le catalogue."}
                </EmptyState>
              )}
              {groups.map(([title, fixed]) => {
                const list = ofKind.filter((c) => fixed === null || c.fixed === fixed);
                if (!list.length) return null;
                return (
                  <div key={String(fixed)}>
                    {title && <h3 className="eyebrow mt-2 mb-1 pl-4">{title}</h3>}
                    <ul className="list !px-0">{list.flatMap((c) => [row(c), ...c.children.map((s) => row(s, c))])}</ul>
                  </div>
                );
              })}
            </Card>
          );
        })}
      </div>
    </>
  );
}
