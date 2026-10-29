import type { Account } from "@prisma/client";
import type { listCategories } from "@/lib/categories";
import { formatDay } from "@/lib/ledger";
import type { getLoan } from "@/lib/loans";
import { centsToInput } from "@/lib/money";
import { createLoanAction, updateLoanAction } from "../actions";
import { ActionForm, Field } from "../form";

export const monthYear = (d: Date) => new Intl.DateTimeFormat("fr-FR", { month: "2-digit", year: "numeric", timeZone: "UTC" }).format(d);

/** « 3450 » → « 3,45 » */
export const rateToInput = (rate: number) => (rate / 1000).toString().replace(".", ",");

/** Création ou modification d'un crédit ; `accounts` = comptes proposés, `categories` = arbre du foyer. */
export function LoanForm({ loan, accounts, categories, firstDue }: {
  loan?: Awaited<ReturnType<typeof getLoan>>; accounts: Account[]; categories: Awaited<ReturnType<typeof listCategories>>; firstDue: string;
}) {
  const c = loan?.fixedCharge;
  return (
    <ActionForm action={loan ? updateLoanAction : createLoanAction}>
      {loan && <input type="hidden" name="id" value={loan.id} />}
      <Field name="name" label="Nom"><input name="name" required maxLength={100} defaultValue={c?.name} /></Field>
      <Field name="principal" label="Capital emprunté">
        <input name="principal" inputMode="decimal" required placeholder="0,00" autoComplete="off" defaultValue={loan ? centsToInput(loan.principal) : ""} />
      </Field>
      <Field name="annualRate" label="Taux annuel (%)">
        <input name="annualRate" inputMode="decimal" required placeholder="3,45" autoComplete="off" defaultValue={loan ? rateToInput(loan.annualRate) : ""} />
      </Field>
      <Field name="termMonths" label="Durée (nombre de mensualités)">
        <input name="termMonths" type="number" min={1} max={600} required defaultValue={loan?.termMonths} />
      </Field>
      <Field name="firstDue" label="Première échéance">
        <input name="firstDue" type="date" required defaultValue={loan ? formatDay(loan.firstDue) : firstDue} />
      </Field>
      <Field name="payment" label="Mensualité hors assurance (facultatif, calculée si vide)">
        <input name="payment" inputMode="decimal" placeholder="0,00" autoComplete="off" defaultValue={loan?.payment ? centsToInput(loan.payment) : ""} />
      </Field>
      <Field name="insurance" label="Assurance mensuelle (facultatif)">
        <input name="insurance" inputMode="decimal" placeholder="0,00" autoComplete="off" defaultValue={loan?.insurance ? centsToInput(loan.insurance) : ""} />
      </Field>
      <Field name="accountId" label="Compte de prélèvement">
        <select name="accountId" defaultValue={c?.accountId}>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.archivedAt ? " (archivé)" : ""}</option>)}
        </select>
      </Field>
      <Field name="categoryId" label="Catégorie">
        <select name="categoryId" defaultValue={c?.categoryId}>
          {categories.filter((k) => k.kind === "EXPENSE").flatMap((k) => [
            <option key={k.id} value={k.id}>{k.name}</option>,
            ...k.children.map((s) => <option key={s.id} value={s.id}>{k.name} › {s.name}</option>),
          ])}
        </select>
      </Field>
      <button type="submit">{loan ? "Enregistrer" : "Créer le crédit"}</button>
    </ActionForm>
  );
}
