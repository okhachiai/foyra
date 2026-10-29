import type { Account } from "@prisma/client";
import { createAccountAction, updateAccountAction } from "../actions";
import { ActionForm, Field } from "../form";
import { KIND_LABELS } from "./kinds";

/**
 * Création (solde initial + partage) ou modification (nom, type, notes) d'un compte.
 * Propriétaire (si `canSetOwner`) : « Commun » ou un membre de `members` ; à la création, `userId` par défaut.
 */
export function AccountForm({ account, members, canSetOwner, userId }: {
  account?: Account; members: { id: string; name: string }[]; canSetOwner: boolean; userId: string;
}) {
  return (
    <ActionForm action={account ? updateAccountAction : createAccountAction}>
      {account && <input type="hidden" name="id" value={account.id} />}
      <Field name="name" label="Nom"><input name="name" required maxLength={100} defaultValue={account?.name} /></Field>
      <Field name="kind" label="Type">
        <select name="kind" defaultValue={account?.kind ?? "CHECKING"}>
          {Object.entries(KIND_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
      </Field>
      {canSetOwner && (
        <Field name="ownerId" label="Propriétaire">
          {account && <input type="hidden" name="ownerWas" value={account.ownerId ?? ""} />}
          <select name="ownerId" defaultValue={account ? (account.ownerId ?? "") : userId}>
            <option value="">Commun (joint)</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </Field>
      )}
      {!account && (
        <>
          <Field name="initialBalance" label="Solde initial (peut être négatif, fixé à la création)">
            <input name="initialBalance" inputMode="decimal" placeholder="0,00" autoComplete="off" />
          </Field>
          <Field name="sharing" label="Partage">
            <select name="sharing" defaultValue="SELECTED">
              <option value="SELECTED">Membres sélectionnés (vous seul pour l’instant)</option>
              <option value="HOUSEHOLD">Tout le foyer (lecture et écriture)</option>
            </select>
          </Field>
        </>
      )}
      <Field name="notes" label="Notes (facultatif)">
        <textarea name="notes" rows={3} maxLength={1000} defaultValue={account?.notes} className="w-full rounded-[0.875rem] border border-border bg-white/[0.03] px-3.5 py-2.5 text-base text-heading" />
      </Field>
      <p className="muted m-0 text-sm">Le type du compte ne change rien aux permissions : elles dépendent uniquement du partage.</p>
      <button type="submit">{account ? "Enregistrer" : "Créer le compte"}</button>
    </ActionForm>
  );
}
