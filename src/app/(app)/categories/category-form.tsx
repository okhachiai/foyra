import Link from "next/link";
import type { Category, CategoryKind } from "@prisma/client";
import { createCategoryAction, updateCategoryAction } from "@/app/actions";
import { ActionForm, Field } from "@/app/form";
import { getI18n } from "@/lib/i18n-server";

/** English source labels; translate with t(). */
export const KIND_LABELS: Record<CategoryKind, string> = { EXPENSE: "Expenses", INCOME: "Income" };

/** Creating (direction + optional parent, fixed afterwards) or editing a catalogue category. */
export async function CategoryForm({ category, kind, parentId }: { category?: Category; kind?: CategoryKind; parentId?: string }) {
  const { t } = await getI18n();
  const topExpense = category ? category.kind === "EXPENSE" && !category.parentId : kind === "EXPENSE" && !parentId;
  return (
    <ActionForm action={category ? updateCategoryAction : createCategoryAction}>
      {category ? (
        <input type="hidden" name="id" value={category.id} />
      ) : (
        <>
          <input type="hidden" name="kind" value={kind} />
          {parentId && <input type="hidden" name="parentId" value={parentId} />}
        </>
      )}
      <Field name="name" label={t("Name")}><input name="name" required maxLength={100} defaultValue={category?.name} /></Field>
      {topExpense && (
        <Field name="fixed" label={t("Charge type")} hint={t("Fixed: bills, subscriptions. Variable: groceries, health…")}>
          <select name="fixed" defaultValue={category?.fixed ? "1" : "0"}>
            <option value="0">{t("Variable expense")}</option>
            <option value="1">{t("Fixed charge")}</option>
          </select>
        </Field>
      )}
      <Field name="sortOrder" label={t("Display order")} hint={t("Smaller numbers appear first.")}>
        <input name="sortOrder" type="number" step={1} defaultValue={category?.sortOrder ?? 0} />
      </Field>
      <fieldset className="flex flex-col gap-0">
        <legend className="mb-1 text-label font-semibold text-heading">{t("Budget")}</legend>
        <label className="check"><input type="checkbox" name="enabled" defaultChecked={category?.enabled ?? true} />{t("Include in the budget")}</label>
        <label className="check"><input type="checkbox" name="recurring" defaultChecked={category?.recurring ?? true} />{t("Carry over to next month")}</label>
        <label className="check"><input type="checkbox" name="isTemplate" defaultChecked={category?.isTemplate ?? true} />{t("Budget template (used when a budget starts from templates)")}</label>
        <small className="hint">{t("Budgets already created are never changed by these settings.")}</small>
      </fieldset>
      <div className="form-actions">
        <button type="submit">{t(category ? "Save" : "Create the category")}</button>
        <Link href="/categories" className="button secondary">{t("Cancel")}</Link>
      </div>
    </ActionForm>
  );
}
