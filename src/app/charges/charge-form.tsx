import type { Account, FixedCharge } from "@prisma/client";
import { formatMonth } from "@/lib/budget";
import type { listCategories } from "@/lib/categories";
import { centsToInput } from "@/lib/money";
import { createChargeAction, updateChargeAction } from "../actions";
import { ActionForm, Field, SharedCheck } from "../form";

/** Création ou modification d'une récurrence (échéance indicative) ; `accounts` = comptes proposés, `categories` = arbre du foyer. */
export function ChargeForm({ charge, accounts, categories, startMonth }: {
  charge?: FixedCharge; accounts: Account[]; categories: Awaited<ReturnType<typeof listCategories>>; startMonth: string;
}) {
  return (
    <ActionForm action={charge ? updateChargeAction : createChargeAction}>
      {charge && <input type="hidden" name="id" value={charge.id} />}
      <Field name="kind" label="Type">
        <select name="kind" defaultValue={charge?.kind ?? "EXPENSE"}>
          <option value="EXPENSE">Dépense</option>
          <option value="INCOME">Revenu</option>
        </select>
      </Field>
      <Field name="name" label="Description"><input name="name" required maxLength={100} defaultValue={charge?.name} /></Field>
      <Field name="amount" label="Montant mensuel">
        <input name="amount" inputMode="decimal" required placeholder="0,00" autoComplete="off" defaultValue={charge ? centsToInput(charge.amount) : ""} />
      </Field>
      <Field name="dueDay" label="Jour d’échéance (1 à 31)">
        <input name="dueDay" type="number" min={1} max={31} required defaultValue={charge?.dueDay} />
      </Field>
      <Field name="accountId" label="Compte">
        <select name="accountId" defaultValue={charge?.accountId}>
          {accounts.map((a) => <option key={a.id} value={a.id} data-common={a.ownerId === null || undefined}>{a.name}{a.archivedAt ? " (archivé)" : ""}</option>)}
        </select>
      </Field>
      <Field name="categoryId" label="Catégorie">
        <select name="categoryId" defaultValue={charge?.categoryId}>
          {(["EXPENSE", "INCOME"] as const).map((kind) => (
            <optgroup key={kind} label={kind === "EXPENSE" ? "Dépenses" : "Revenus"}>
              {categories.filter((c) => c.kind === kind).flatMap((c) => [
                <option key={c.id} value={c.id}>{c.name}</option>,
                ...c.children.map((s) => <option key={s.id} value={s.id}>{c.name} › {s.name}</option>),
              ])}
            </optgroup>
          ))}
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
      <p className="muted m-0 text-sm">Échéance indicative : aucun paiement n’est créé automatiquement et aucun solde n’est modifié.</p>
      <button type="submit">{charge ? "Enregistrer" : "Créer la récurrence"}</button>
    </ActionForm>
  );
}
