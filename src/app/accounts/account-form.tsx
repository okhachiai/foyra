import type { Account } from "@prisma/client";
import { centsToInput } from "@/lib/money";
import { createAccountAction, updateAccountAction } from "../actions";
import { ActionForm, Field } from "../form";
import { KIND_LABELS } from "./kinds";

export function AccountForm({ account }: { account?: Account }) {
  return (
    <ActionForm action={account ? updateAccountAction : createAccountAction}>
      {account && <input type="hidden" name="id" value={account.id} />}
      <Field name="name" label="Nom"><input name="name" required maxLength={100} defaultValue={account?.name} /></Field>
      <Field name="kind" label="Type">
        <select name="kind" defaultValue={account?.kind ?? "CHECKING"}>
          {Object.entries(KIND_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
      </Field>
      <Field name="initialBalance" label="Solde initial (peut être négatif)">
        <input name="initialBalance" inputMode="decimal" placeholder="0,00" defaultValue={account ? centsToInput(account.initialBalance) : ""} />
      </Field>
      <button type="submit">{account ? "Enregistrer" : "Créer le compte"}</button>
    </ActionForm>
  );
}
