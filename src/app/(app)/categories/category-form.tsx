import Link from "next/link";
import type { Category, CategoryKind } from "@prisma/client";
import { createCategoryAction, updateCategoryAction } from "@/app/actions";
import { ActionForm, Field } from "@/app/form";

export const KIND_LABELS: Record<CategoryKind, string> = { EXPENSE: "Dépenses", INCOME: "Revenus" };

/** Création (sens + parent facultatif, figés ensuite) ou modification d'une catégorie du catalogue. */
export function CategoryForm({ category, kind, parentId }: { category?: Category; kind?: CategoryKind; parentId?: string }) {
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
      <Field name="name" label="Nom"><input name="name" required maxLength={100} defaultValue={category?.name} /></Field>
      {topExpense && (
        <Field name="fixed" label="Type de charge" hint="Fixe : factures, abonnements. Variable : courses, santé…">
          <select name="fixed" defaultValue={category?.fixed ? "1" : "0"}>
            <option value="0">Charge variable</option>
            <option value="1">Charge fixe</option>
          </select>
        </Field>
      )}
      <Field name="sortOrder" label="Ordre d’affichage" hint="Les plus petits nombres apparaissent en premier.">
        <input name="sortOrder" type="number" step={1} defaultValue={category?.sortOrder ?? 0} />
      </Field>
      <fieldset className="flex flex-col gap-0">
        <legend className="mb-1 text-label font-semibold text-heading">Budget</legend>
        <label className="check"><input type="checkbox" name="enabled" defaultChecked={category?.enabled ?? true} />Inclure dans le budget</label>
        <label className="check"><input type="checkbox" name="recurring" defaultChecked={category?.recurring ?? true} />Reprendre le mois suivant</label>
        <label className="check"><input type="checkbox" name="isTemplate" defaultChecked={category?.isTemplate ?? true} />Modèle de budget (utilisée quand un budget part des modèles)</label>
        <small className="hint">Les budgets déjà créés ne sont jamais modifiés par ces réglages.</small>
      </fieldset>
      <div className="form-actions">
        <button type="submit">{category ? "Enregistrer" : "Créer la catégorie"}</button>
        <Link href="/categories" className="button secondary">Annuler</Link>
      </div>
    </ActionForm>
  );
}
