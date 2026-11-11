import { addMonths } from "@/lib/amortization";
import { formatMonth } from "@/lib/budget";
import { formatDay } from "@/lib/ledger";
import { centsToInput } from "@/lib/money";
import { payChargeAction } from "@/app/actions";
import { ActionForm, Field } from "@/app/form";
import { getI18n } from "@/lib/i18n-server";

/** "Mark paid" for a payment of month `month`: records the actual expense (amount and date editable, date bounded to the month). */
export async function PayCharge({ id, month, amount, due, back, late }: { id: string; month: Date; amount: number; due: Date; back?: "calendar"; late?: boolean }) {
  const { t } = await getI18n();
  const m = formatMonth(month);
  const lastDay = formatDay(new Date(addMonths(month, 1).getTime() - 86_400_000));
  return (
    <details className="pay">
      <summary className={late ? "button" : "button secondary"}>{t("Mark paid")}</summary>
      <ActionForm action={payChargeAction} className="form pay-form">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="month" value={m} />
        {back && <input type="hidden" name="back" value={back} />}
        <Field name="amount" label={t("Amount")}>
          <input name="amount" inputMode="decimal" required autoComplete="off" defaultValue={amount ? centsToInput(amount) : ""} />
        </Field>
        <Field name="occurredOn" label={t("Date")}>
          <input name="occurredOn" type="date" required min={`${m}-01`} max={lastDay} defaultValue={formatDay(due)} />
        </Field>
        <button type="submit">{t("Record the expense")}</button>
      </ActionForm>
    </details>
  );
}
