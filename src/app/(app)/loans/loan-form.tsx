import Link from "next/link";
import type { listCategories } from "@/lib/categories";
import { formatDay } from "@/lib/ledger";
import type { getLoan } from "@/lib/loans";
import { centsToInput } from "@/lib/money";
import { createLoanAction, updateLoanAction } from "@/app/actions";
import { ActionForm, Field } from "@/app/form";
import type { T } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n-server";

export const monthYear = (d: Date, intl: string) => new Intl.DateTimeFormat(intl, { month: "2-digit", year: "numeric", timeZone: "UTC" }).format(d);

/** Number of monthly payments → "3 years 4 months" */
export const duration = (months: number, t: T) => {
  const y = Math.floor(months / 12), m = months % 12;
  return [y && t(y > 1 ? "{n} years" : "{n} year", { n: y }), m && t(m > 1 ? "{n} months" : "{n} month", { n: m })].filter(Boolean).join(" ") || "—";
};

/** 3450 → "3.45" (input value; the action accepts both separators). */
export const rateToInput = (rate: number) => (rate / 1000).toString();

/** 3450 → "3.45%" in the UI language. */
export const rateLabel = (rate: number, intl: string) => `${new Intl.NumberFormat(intl, { maximumFractionDigits: 3 }).format(rate / 1000)}%`;

/** Creating or editing a loan; `categories` = household tree. */
export async function LoanForm({ loan, categories, firstDue }: {
  loan?: Awaited<ReturnType<typeof getLoan>>; categories: Awaited<ReturnType<typeof listCategories>>; firstDue: string;
}) {
  const { t } = await getI18n();
  const c = loan?.fixedCharge;
  // Simple loan: no interest, principal = payment × number (the principal is not shown again).
  const simple = !!loan && loan.annualRate === 0 && loan.payment !== null && loan.principal === loan.payment * loan.termMonths;
  return (
    <ActionForm action={loan ? updateLoanAction : createLoanAction}>
      {loan && <input type="hidden" name="id" value={loan.id} />}
      <Field name="name" label={t("Name")}><input name="name" required maxLength={100} defaultValue={c?.name} /></Field>
      <Field name="firstDue" label={t("First payment date")}>
        <input name="firstDue" type="date" required defaultValue={loan ? formatDay(loan.firstDue) : firstDue} />
      </Field>
      <Field name="termMonths" label={t("Number of payments")}>
        <input name="termMonths" type="number" min={1} max={600} required defaultValue={loan?.termMonths} />
      </Field>
      <Field name="payment" label={t("Amount of each payment")}>
        <input name="payment" inputMode="decimal" placeholder="0.00" autoComplete="off" defaultValue={loan?.payment ? centsToInput(loan.payment) : ""} />
      </Field>
      <details open={!!loan && !simple}>
        <summary>{t("Loan with interest (optional)")}</summary>
        <Field name="principal" label={t("Amount borrowed (empty = simple loan, no interest)")}>
          <input name="principal" inputMode="decimal" placeholder="0.00" autoComplete="off" defaultValue={loan && !simple ? centsToInput(loan.principal) : ""} />
        </Field>
        <Field name="annualRate" label={t("Annual rate (%)")}>
          <input name="annualRate" inputMode="decimal" placeholder="3.45" autoComplete="off" defaultValue={loan && !simple ? rateToInput(loan.annualRate) : ""} />
        </Field>
        <Field name="insurance" label={t("Monthly insurance")}>
          <input name="insurance" inputMode="decimal" placeholder="0.00" autoComplete="off" defaultValue={loan?.insurance ? centsToInput(loan.insurance) : ""} />
        </Field>
        <small className="muted">{t("With a principal, the payment amount excludes insurance; empty = computed.")}</small>
      </details>
      <Field name="categoryId" label={t("Category")}>
        <select name="categoryId" defaultValue={c?.categoryId}>
          {categories.filter((k) => k.kind === "EXPENSE").flatMap((k) => [
            <option key={k.id} value={k.id}>{k.name}</option>,
            ...k.children.map((s) => <option key={s.id} value={s.id}>{k.name} › {s.name}</option>),
          ])}
        </select>
      </Field>
      <div className="form-actions">
        <button type="submit">{t(loan ? "Save" : "Create the loan")}</button>
        {!loan && <Link href="/loans" className="button secondary">{t("Cancel")}</Link>}
      </div>
    </ActionForm>
  );
}
