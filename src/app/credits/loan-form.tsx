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
  // Crédit simple : sans intérêts, capital = échéance × nombre (le capital n'est pas réaffiché).
  const simple = !!loan && loan.annualRate === 0 && loan.payment !== null && loan.principal === loan.payment * loan.termMonths;
  return (
    <ActionForm action={loan ? updateLoanAction : createLoanAction}>
      {loan && <input type="hidden" name="id" value={loan.id} />}
      <Field name="name" label="Nom"><input name="name" required maxLength={100} defaultValue={c?.name} /></Field>
      <Field name="firstDue" label="Date de la 1ʳᵉ échéance">
        <input name="firstDue" type="date" required defaultValue={loan ? formatDay(loan.firstDue) : firstDue} />
      </Field>
      <Field name="termMonths" label="Nombre d’échéances">
        <input name="termMonths" type="number" min={1} max={600} required defaultValue={loan?.termMonths} />
      </Field>
      <Field name="payment" label="Montant de chaque échéance">
        <input name="payment" inputMode="decimal" placeholder="0,00" autoComplete="off" defaultValue={loan?.payment ? centsToInput(loan.payment) : ""} />
      </Field>
      <details open={!!loan && !simple}>
        <summary>Prêt avec intérêts (facultatif)</summary>
        <Field name="principal" label="Capital emprunté (vide = crédit simple, sans intérêts)">
          <input name="principal" inputMode="decimal" placeholder="0,00" autoComplete="off" defaultValue={loan && !simple ? centsToInput(loan.principal) : ""} />
        </Field>
        <Field name="annualRate" label="Taux annuel (%)">
          <input name="annualRate" inputMode="decimal" placeholder="3,45" autoComplete="off" defaultValue={loan && !simple ? rateToInput(loan.annualRate) : ""} />
        </Field>
        <Field name="insurance" label="Assurance mensuelle">
          <input name="insurance" inputMode="decimal" placeholder="0,00" autoComplete="off" defaultValue={loan?.insurance ? centsToInput(loan.insurance) : ""} />
        </Field>
        <small className="muted">Avec un capital, le montant de l’échéance est hors assurance ; vide = calculé.</small>
      </details>
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
