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
import { getI18n } from "@/lib/i18n-server";

export default async function EditCategoryPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const { t } = await getI18n();
  const category = await getCategory(admin.householdId, (await params).id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const archived = category.archivedAt !== null;
  const children = category._count.children;

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/categories" className="text-[inherit] no-underline hover:underline">{t("Settings")} / {t("Categories")}</Link>}
        title={category.parent ? `${category.parent.name} › ${category.name}` : category.name}
        subtitle={<>{t(KIND_LABELS[category.kind])} {archived && <Badge tone="warning">{t("archived")}</Badge>}</>}
        actions={
          <>
            <Link href="/categories" className="button ghost"><Icon name="chevronLeft" className="size-4" />{t("Categories")}</Link>
            {!category.parent && !archived && (
              <Link href={`/categories/new?parent=${category.id}`} className="button secondary"><Icon name="plus" className="size-4" />{t("Subcategory")}</Link>
            )}
          </>
        }
      />

      <div className="grid max-w-3xl gap-4">
        <Card>
          <SectionHeader title={t("Settings")} />
          <CategoryForm category={category} />
        </Card>

        <Card className="danger-card">
          <SectionHeader title={t("Danger zone")} subtitle={t("To remove it without losing how history is classified, archive it rather than delete it.")} />
          <div className="flex flex-wrap gap-2">
            <ActionForm
              action={archiveCategoryAction} className="inline"
              confirm={archived ? undefined : t(children ? "Archive this category and its subcategories? It disappears from new budgets and new entries; history is kept." : "Archive this category? It disappears from new budgets and new entries; history is kept.")}
            >
              <input type="hidden" name="id" value={category.id} />
              <input type="hidden" name="restore" value={archived ? "1" : "0"} />
              <button type="submit" className="secondary">{t(archived ? "Reactivate" : "Archive")}</button>
            </ActionForm>
            <ActionForm
              action={deleteCategoryAction} className="inline"
              confirm={t(children ? "Permanently delete this category and its subcategories? The affected transactions and budgets are kept, uncategorized." : "Permanently delete this category? The affected transactions and budgets are kept, uncategorized.")}
            >
              <input type="hidden" name="id" value={category.id} />
              <button type="submit" className="danger">{t("Delete")}</button>
            </ActionForm>
          </div>
        </Card>
      </div>
    </>
  );
}
