import { addMonths } from "@/lib/amortization";
import { formatMonth } from "@/lib/budget";
import { formatDay } from "@/lib/ledger";
import { centsToInput } from "@/lib/money";
import { payChargeAction } from "@/app/actions";
import { ActionForm, Field } from "@/app/form";

/** « Marquer payée » d'une échéance du mois `month` : enregistre la dépense réelle (montant et date modifiables, date bornée au mois). */
export function PayCharge({ id, month, amount, due, back, late }: { id: string; month: Date; amount: number; due: Date; back?: "calendar"; late?: boolean }) {
  const m = formatMonth(month);
  const lastDay = formatDay(new Date(addMonths(month, 1).getTime() - 86_400_000));
  return (
    <details className="pay">
      <summary className={late ? "button" : "button secondary"}>Marquer payée</summary>
      <ActionForm action={payChargeAction} className="form pay-form">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="month" value={m} />
        {back && <input type="hidden" name="back" value={back} />}
        <Field name="amount" label="Montant">
          <input name="amount" inputMode="decimal" required autoComplete="off" defaultValue={amount ? centsToInput(amount) : ""} />
        </Field>
        <Field name="occurredOn" label="Date">
          <input name="occurredOn" type="date" required min={`${m}-01`} max={lastDay} defaultValue={formatDay(due)} />
        </Field>
        <button type="submit">Enregistrer la dépense</button>
      </ActionForm>
    </details>
  );
}
