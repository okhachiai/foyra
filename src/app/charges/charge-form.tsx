import type { FixedCharge } from "@prisma/client";
import { formatMonth } from "@/lib/budget";
import type { listCategories } from "@/lib/categories";
import { createChargeAction, updateChargeAction } from "../actions";
import { ActionForm, Field, SharedCheck } from "../form";

/** Création ou modification d'une récurrence (échéance indicative) ; `categories` = arbre du foyer. */
export function ChargeForm({ charge, categories, startMonth }: {
  charge?: FixedCharge; categories: Awaited<ReturnType<typeof listCategories>>; startMonth: string;
}) {
  return (
    <ActionForm action={charge ? updateChargeAction : createChargeAction}>
      {charge && <input type="hidden" name="id" value={charge.id} />}
      <Field name="name" label="Description"><input name="name" required maxLength={100} defaultValue={charge?.name} /></Field>
      <Field name="dueDay" label="Jour d’échéance (1 à 31)">
        <input name="dueDay" type="number" min={1} max={31} required defaultValue={charge?.dueDay} />
      </Field>
      <Field name="categoryId" label="Catégorie">
        <select name="categoryId" defaultValue={charge?.categoryId}>
          {categories.filter((c) => c.kind === "EXPENSE").flatMap((c) => [
            <option key={c.id} value={c.id}>{c.name}</option>,
            ...c.children.map((s) => <option key={s.id} value={s.id}>{c.name} › {s.name}</option>),
          ])}
        </select>
      </Field>
      <Field name="startMonth" label="Mois de début">
        <input name="startMonth" type="month" required defaultValue={charge ? formatMonth(charge.startMonth) : startMonth} />
      </Field>
      <Field name="endMonth" label="Dernier mois (facultatif)">
        <input name="endMonth" type="month" defaultValue={charge?.endMonth ? formatMonth(charge.endMonth) : ""} />
      </Field>
      <SharedCheck label="Charge commune" checked={charge?.shared ?? true} />
      <label className="check"><input type="checkbox" name="active" defaultChecked={charge?.active ?? true} />Active</label>
      <p className="muted m-0 text-sm">Échéance indicative : aucun paiement n’est créé automatiquement. Le montant est celui de la ligne du budget du mois de même catégorie.</p>
      <button type="submit">{charge ? "Enregistrer" : "Créer la récurrence"}</button>
    </ActionForm>
  );
}
