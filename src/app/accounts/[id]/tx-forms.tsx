import type { Account } from "@prisma/client";
import type { listCategories } from "@/lib/categories";
import { centsToInput } from "@/lib/money";
import { createEntryAction, createTransferAction, updateTransactionAction } from "../../actions";
import { ActionForm, Field } from "../../form";

/**
 * Clé d'idempotence, tirée à chaque rendu serveur du formulaire : un double clic ou une nouvelle tentative
 * après erreur renvoie la même clé (aucun doublon) ; après succès, la page est rendue à nouveau avec une clé neuve.
 */
const IdempotencyKey = () => <input type="hidden" name="idempotencyKey" value={crypto.randomUUID()} />;

type Values = { id?: string; amount?: number; occurredOn: string; note?: string | null; categoryId?: string | null; shared?: boolean };
export type CategoryTree = Awaited<ReturnType<typeof listCategories>>;

function CommonFields({ v }: { v: Values }) {
  return (
    <>
      <Field name="amount" label="Montant">
        <input name="amount" inputMode="decimal" required placeholder="0,00" autoComplete="off" defaultValue={v.amount ? centsToInput(v.amount) : ""} />
      </Field>
      <Field name="occurredOn" label="Date"><input name="occurredOn" type="date" required defaultValue={v.occurredOn} /></Field>
      <Field name="note" label="Note / libellé (facultatif)"><input name="note" maxLength={500} defaultValue={v.note ?? ""} /></Field>
    </>
  );
}

/**
 * Case « commune » ; `sharedField` signale qu'elle était affichée (absente = choix laissé au serveur).
 * Masquée en CSS quand le compte choisi est commun (`option[data-common]`, cf. globals.css) : le serveur la force alors.
 */
export function SharedCheck({ label, checked }: { label: string; checked: boolean }) {
  return (
    <label className="check shared-check">
      <input type="hidden" name="sharedField" value="1" />
      <input type="checkbox" name="shared" defaultChecked={checked} />{label}
    </label>
  );
}

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

/**
 * Avec `accounts` (tableau de bord) : choix du compte et retour au tableau de bord ; sinon compte fixe `accountId`
 * (`personal` : il a un propriétaire, la case « Dépense commune » est proposée).
 */
export function EntryForm({ accountId, accounts, personal, kind = "EXPENSE", categories, v }: {
  accountId?: string; accounts?: { id: string; name: string; ownerId: string | null }[]; personal?: boolean;
  kind?: "INCOME" | "EXPENSE"; categories: CategoryTree; v: Values;
}) {
  return (
    <ActionForm action={v.id ? updateTransactionAction : createEntryAction}>
      {v.id ? <input type="hidden" name="id" value={v.id} /> : <IdempotencyKey />}
      {accounts ? (
        <>
          <Field name="accountId" label="Compte">
            <select name="accountId">
              {accounts.map((a) => <option key={a.id} value={a.id} data-common={a.ownerId === null || undefined}>{a.name}</option>)}
            </select>
          </Field>
          <input type="hidden" name="back" value="dashboard" />
        </>
      ) : (
        <>
          <input type="hidden" name="accountId" value={accountId} />
          <input type="hidden" name="returnTo" value={accountId} />
        </>
      )}
      <Field name="kind" label="Type">
        <select name="kind" defaultValue={kind}>
          <option value="EXPENSE">Dépense</option>
          <option value="INCOME">Revenu</option>
        </select>
      </Field>
      <CategorySelect categories={categories} value={v.categoryId} />
      <CommonFields v={v} />
      {(accounts || personal) && <SharedCheck label="Dépense commune" checked={v.shared ?? false} />}
      <button type="submit">Enregistrer</button>
    </ActionForm>
  );
}

export function TransferForm({ accounts, from, to, returnTo, v }: { accounts: Account[]; from: string; to?: string; returnTo: string; v: Values }) {
  const options = accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>);
  return (
    <ActionForm action={v.id ? updateTransactionAction : createTransferAction}>
      {v.id ? <input type="hidden" name="id" value={v.id} /> : <IdempotencyKey />}
      <input type="hidden" name="returnTo" value={returnTo} />
      <Field name="fromAccountId" label="Depuis"><select name="fromAccountId" defaultValue={from}>{options}</select></Field>
      <Field name="toAccountId" label="Vers">
        <select name="toAccountId" defaultValue={to ?? accounts.find((a) => a.id !== from)?.id}>{options}</select>
      </Field>
      <CommonFields v={v} />
      <button type="submit">Enregistrer le virement</button>
    </ActionForm>
  );
}
