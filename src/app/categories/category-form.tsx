import type { CarryOver, Category, CategoryKind } from "@prisma/client";
import { centsToInput } from "@/lib/money";
import { createCategoryAction, updateCategoryAction } from "../actions";
import { ActionForm, Field } from "../form";

export const KIND_LABELS: Record<CategoryKind, string> = { EXPENSE: "Dépenses", INCOME: "Revenus" };

const CARRY_OVER_LABELS: Record<CarryOver, string> = {
  FORECAST: "Repartir du prévisionnel",
  PREVIOUS: "Reprendre le montant du mois précédent",
  NONE: "À saisir chaque mois",
};

/** Création (kind + parent facultatif, figés ensuite) ou modification d'une catégorie. */
export function CategoryForm({ category, kind, parentId }: { category?: Category; kind?: CategoryKind; parentId?: string }) {
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
      <Field name="forecastAmount" label="Montant prévisionnel mensuel (facultatif)">
        <input
          name="forecastAmount" inputMode="decimal" placeholder="0,00" autoComplete="off"
          defaultValue={category?.forecastAmount != null ? centsToInput(category.forecastAmount) : ""}
        />
      </Field>
      <Field name="carryOver" label="Mois suivant">
        <select name="carryOver" defaultValue={category?.carryOver ?? "FORECAST"}>
          {Object.entries(CARRY_OVER_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
      </Field>
      <label className="check">
        <input type="checkbox" name="enabled" defaultChecked={category?.enabled ?? true} />
        Inclure dans le budget
      </label>
      <button type="submit">{category ? "Enregistrer" : "Créer la catégorie"}</button>
    </ActionForm>
  );
}
