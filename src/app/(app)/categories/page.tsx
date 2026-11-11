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
import { getI18n } from "@/lib/i18n-server";

export default async function CategoriesPage() {
  const user = await requireUser();
  const { t } = await getI18n();
  const admin = user.role === "ADMIN";
  const categories = await listCategories(user.householdId, { withArchived: true });

  // Subcategory: indented under its parent, from which it inherits archiving and exclusion.
  const row = (c: Category, parent?: Category) => {
    const body = (
      <>
        <span className={parent ? "flex items-center gap-2 ps-4 !font-medium" : undefined}>
          {parent && <span aria-hidden className="text-faint rtl:-scale-x-100">↳</span>}
          {parent && <span className="sr-only">{parent.name} › </span>}
          {c.name}
        </span>
        <span className="flex flex-wrap items-center justify-end gap-1">
          {(c.archivedAt || parent?.archivedAt) && <Badge tone="warning">{t("archived")}</Badge>}
          {(!c.enabled || parent?.enabled === false) && <Badge tone="muted">{t("excluded")}</Badge>}
          {!c.recurring && <Badge tone="muted">{t("not carried over")}</Badge>}
          {!c.isTemplate && <Badge tone="muted">{t("not a template")}</Badge>}
          {admin && <Icon name="chevron" className="size-4 text-faint" />}
        </span>
      </>
    );
    return <li key={c.id}>{admin ? <Link href={`/categories/${c.id}`}>{body}</Link> : <div>{body}</div>}</li>;
  };

  return (
    <>
      <PageHeader
        eyebrow={t("Settings")} title={t("Categories")}
        subtitle={t("Budget catalogue and templates: inclusion, carry-over and order. Amounts are entered in the month’s budget.") + (admin ? "" : ` ${t("Only administrators can change the catalogue.")}`)}
        actions={admin && (
          <ActionForm action={addDefaultCategoriesAction} className="inline">
            <button type="submit" className="secondary">{t(categories.length ? "Add missing templates" : "Create the category templates")}</button>
          </ActionForm>
        )}
      />
      <SettingsNav admin={admin} />

      <div className="grid items-start gap-4 xl:grid-cols-2">
        {(["INCOME", "EXPENSE"] as CategoryKind[]).map((kind) => {
          const ofKind = categories.filter((c) => c.kind === kind);
          const groups = kind === "EXPENSE" ? ([["Fixed charges", true], ["Variable expenses", false]] as const) : ([[null, null]] as const);
          return (
            <Card key={kind} variant="table">
              <SectionHeader
                title={t(KIND_LABELS[kind])}
                subtitle={t(ofKind.length > 1 ? "{n} categories" : "{n} category", { n: ofKind.length })}
                action={admin && <Link href={`/categories/new?kind=${kind}`} className="button secondary"><Icon name="plus" className="size-4" />{t("Add")}</Link>}
              />
              {!ofKind.length && (
                <EmptyState title={t("No categories")} className="mb-3">
                  {t(admin ? "Add one or create the category templates." : "An administrator must fill in the catalogue.")}
                </EmptyState>
              )}
              {groups.map(([title, fixed]) => {
                const list = ofKind.filter((c) => fixed === null || c.fixed === fixed);
                if (!list.length) return null;
                return (
                  <div key={String(fixed)}>
                    {title && <h3 className="eyebrow mt-2 mb-1 ps-4">{t(title)}</h3>}
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
