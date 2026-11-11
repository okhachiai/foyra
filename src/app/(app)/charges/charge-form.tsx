import Link from "next/link";
import type { FixedCharge } from "@prisma/client";
import { formatMonth } from "@/lib/budget";
import type { listCategories } from "@/lib/categories";
import { createChargeAction, updateChargeAction } from "@/app/actions";
import { ActionForm, Field, SharedCheck } from "@/app/form";
import { getI18n } from "@/lib/i18n-server";

/** Creating or editing a recurring charge (indicative due date); `categories` = household tree. */
export async function ChargeForm({ charge, categories, startMonth }: {
  charge?: FixedCharge; categories: Awaited<ReturnType<typeof listCategories>>; startMonth: string;
}) {
  const { t } = await getI18n();
  return (
    <ActionForm action={charge ? updateChargeAction : createChargeAction}>
      {charge && <input type="hidden" name="id" value={charge.id} />}
      <Field name="name" label={t("Description")}><input name="name" required maxLength={100} defaultValue={charge?.name} /></Field>
      <Field name="dueDay" label={t("Due day (1 to 31)")}>
        <input name="dueDay" type="number" min={1} max={31} required defaultValue={charge?.dueDay} />
      </Field>
      <Field name="categoryId" label={t("Category")}>
        <select name="categoryId" defaultValue={charge?.categoryId}>
          {categories.filter((c) => c.kind === "EXPENSE").flatMap((c) => [
            <option key={c.id} value={c.id}>{c.name}</option>,
            ...c.children.map((s) => <option key={s.id} value={s.id}>{c.name} › {s.name}</option>),
          ])}
        </select>
      </Field>
      <Field name="startMonth" label={t("Start month")}>
        <input name="startMonth" type="month" required defaultValue={charge ? formatMonth(charge.startMonth) : startMonth} />
      </Field>
      <Field name="endMonth" label={t("Last month (optional)")}>
        <input name="endMonth" type="month" defaultValue={charge?.endMonth ? formatMonth(charge.endMonth) : ""} />
      </Field>
      <SharedCheck label={t("Shared charge")} checked={charge?.shared ?? true} />
      <label className="check"><input type="checkbox" name="active" defaultChecked={charge?.active ?? true} />{t("Active")}</label>
      <p className="hint m-0">{t("Indicative due date: no payment is created automatically. The amount is that of the month’s budget line with the same category.")}</p>
      <div className="form-actions">
        <button type="submit">{t(charge ? "Save" : "Create the recurring charge")}</button>
        <Link href="/charges" className="button secondary">{t("Cancel")}</Link>
      </div>
    </ActionForm>
  );
}
