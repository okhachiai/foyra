import type { Account } from "@prisma/client";
import { centsToInput } from "@/lib/money";
import { createEntryAction, createTransferAction, updateTransactionAction } from "../../actions";
import { ActionForm, Field } from "../../form";

type Values = { id?: string; amount?: number; occurredOn: string; note?: string | null };

function CommonFields({ v }: { v: Values }) {
  return (
    <>
      <Field name="amount" label="Montant">
        <input name="amount" inputMode="decimal" required placeholder="0,00" autoComplete="off" defaultValue={v.amount ? centsToInput(v.amount) : ""} />
      </Field>
      <Field name="occurredOn" label="Date"><input name="occurredOn" type="date" required defaultValue={v.occurredOn} /></Field>
      <Field name="note" label="Libellé (facultatif)"><input name="note" maxLength={500} defaultValue={v.note ?? ""} /></Field>
    </>
  );
}

export function EntryForm({ accountId, kind = "EXPENSE", v }: { accountId: string; kind?: "INCOME" | "EXPENSE"; v: Values }) {
  return (
    <ActionForm action={v.id ? updateTransactionAction : createEntryAction}>
      {v.id && <input type="hidden" name="id" value={v.id} />}
      <input type="hidden" name="accountId" value={accountId} />
      <input type="hidden" name="returnTo" value={accountId} />
      <Field name="kind" label="Type">
        <select name="kind" defaultValue={kind}>
          <option value="EXPENSE">Dépense</option>
          <option value="INCOME">Recette</option>
        </select>
      </Field>
      <CommonFields v={v} />
      <button type="submit">Enregistrer</button>
    </ActionForm>
  );
}

export function TransferForm({ accounts, from, to, returnTo, v }: { accounts: Account[]; from: string; to?: string; returnTo: string; v: Values }) {
  const options = accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>);
  return (
    <ActionForm action={v.id ? updateTransactionAction : createTransferAction}>
      {v.id && <input type="hidden" name="id" value={v.id} />}
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
