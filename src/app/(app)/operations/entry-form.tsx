import type { listCategories } from "@/lib/categories";
import { centsToInput } from "@/lib/money";
import { createEntryAction, updateTransactionAction } from "@/app/actions";
import { ActionForm, Field, SharedCheck } from "@/app/form";

/**
 * Clé d'idempotence, tirée à chaque rendu serveur du formulaire : un double clic ou une nouvelle tentative
 * après erreur renvoie la même clé (aucun doublon) ; après succès, la page est rendue à nouveau avec une clé neuve.
 */
const IdempotencyKey = () => <input type="hidden" name="idempotencyKey" value={crypto.randomUUID()} />;

type Values = {
  id?: string; kind?: "INCOME" | "EXPENSE"; amount?: number; occurredOn: string; note?: string | null;
  categoryId?: string | null; paidById: string; shared?: boolean;
};
export type CategoryTree = Awaited<ReturnType<typeof listCategories>>;

function CategorySelect({ categories, value }: { categories: CategoryTree; value?: string | null }) {
  const group = (kind: "INCOME" | "EXPENSE", label: string) => (
    <optgroup label={label}>
      {categories.filter((c) => c.kind === kind).flatMap((c) => [
        <option key={c.id} value={c.id}>{c.name}</option>,
        ...c.children.map((s) => <option key={s.id} value={s.id}>{c.name} › {s.name}</option>),
      ])}
    </optgroup>
  );
  return (
    <Field name="categoryId" label="Catégorie">
      <select name="categoryId" defaultValue={value ?? ""}>
        <option value="">Sans catégorie</option>
        {group("EXPENSE", "Dépenses")}
        {group("INCOME", "Revenus")}
      </select>
    </Field>
  );
}

/** Saisie ou modification d'une opération ; `back` : page de retour après création (liste des opérations par défaut). */
export function EntryForm({ members, categories, v, back }: {
  members: { id: string; name: string }[]; categories: CategoryTree; v: Values; back?: "dashboard" | "budget";
}) {
  return (
    <ActionForm action={v.id ? updateTransactionAction : createEntryAction}>
      {v.id ? <input type="hidden" name="id" value={v.id} /> : <IdempotencyKey />}
      {back && <input type="hidden" name="back" value={back} />}
      <Field name="kind" label="Type">
        <select name="kind" defaultValue={v.kind ?? "EXPENSE"}>
          <option value="EXPENSE">Dépense</option>
          <option value="INCOME">Revenu</option>
        </select>
      </Field>
      <CategorySelect categories={categories} value={v.categoryId} />
      <Field name="amount" label="Montant">
        <input name="amount" inputMode="decimal" required placeholder="0,00" autoComplete="off" defaultValue={v.amount ? centsToInput(v.amount) : ""} />
      </Field>
      <Field name="occurredOn" label="Date"><input name="occurredOn" type="date" required defaultValue={v.occurredOn} /></Field>
      <Field name="note" label="Note / libellé (facultatif)"><input name="note" maxLength={500} defaultValue={v.note ?? ""} /></Field>
      <Field name="paidById" label="Payé / reçu par">
        <select name="paidById" defaultValue={v.paidById}>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </Field>
      <SharedCheck label="Commune (partagée au prorata des revenus)" checked={v.shared ?? false} />
      <div className="form-actions"><button type="submit">Enregistrer</button></div>
    </ActionForm>
  );
}
