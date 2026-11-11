import type { listCategories } from "@/lib/categories";
import { centsToInput } from "@/lib/money";
import { createEntryAction, updateTransactionAction } from "@/app/actions";
import { ActionForm, Field, SharedCheck } from "@/app/form";
import { getI18n } from "@/lib/i18n-server";

/**
 * Idempotency key, drawn on each server render of the form: a double click or a retry after an error
 * sends the same key (no duplicate); after success the page renders again with a fresh key.
 */
const IdempotencyKey = () => <input type="hidden" name="idempotencyKey" value={crypto.randomUUID()} />;

type Values = {
  id?: string; kind?: "INCOME" | "EXPENSE"; amount?: number; occurredOn: string; note?: string | null;
  categoryId?: string | null; paidById: string; shared?: boolean;
};
export type CategoryTree = Awaited<ReturnType<typeof listCategories>>;

async function CategorySelect({ categories, value }: { categories: CategoryTree; value?: string | null }) {
  const { t } = await getI18n();
  const group = (kind: "INCOME" | "EXPENSE", label: string) => (
    <optgroup label={label}>
      {categories.filter((c) => c.kind === kind).flatMap((c) => [
        <option key={c.id} value={c.id}>{c.name}</option>,
        ...c.children.map((s) => <option key={s.id} value={s.id}>{c.name} › {s.name}</option>),
      ])}
    </optgroup>
  );
  return (
    <Field name="categoryId" label={t("Category")}>
      <select name="categoryId" defaultValue={value ?? ""}>
        <option value="">{t("Uncategorized")}</option>
        {group("EXPENSE", t("Expenses"))}
        {group("INCOME", t("Income"))}
      </select>
    </Field>
  );
}

/** Entering or editing a transaction; `back`: return page after creation (transactions list by default). */
export async function EntryForm({ members, categories, v, back }: {
  members: { id: string; name: string }[]; categories: CategoryTree; v: Values; back?: "dashboard" | "budget";
}) {
  const { t } = await getI18n();
  return (
    <ActionForm action={v.id ? updateTransactionAction : createEntryAction}>
      {v.id ? <input type="hidden" name="id" value={v.id} /> : <IdempotencyKey />}
      {back && <input type="hidden" name="back" value={back} />}
      <Field name="kind" label={t("Type")}>
        <select name="kind" defaultValue={v.kind ?? "EXPENSE"}>
          <option value="EXPENSE">{t("Expense")}</option>
          <option value="INCOME">{t("Income")}</option>
        </select>
      </Field>
      <CategorySelect categories={categories} value={v.categoryId} />
      <Field name="amount" label={t("Amount")}>
        <input name="amount" inputMode="decimal" required placeholder="0.00" autoComplete="off" defaultValue={v.amount ? centsToInput(v.amount) : ""} />
      </Field>
      <Field name="occurredOn" label={t("Date")}><input name="occurredOn" type="date" required defaultValue={v.occurredOn} /></Field>
      <Field name="note" label={t("Note / label (optional)")}><input name="note" maxLength={500} defaultValue={v.note ?? ""} /></Field>
      <Field name="paidById" label={t("Paid / received by")}>
        <select name="paidById" defaultValue={v.paidById}>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </Field>
      <SharedCheck label={t("Shared (split in proportion to income)")} checked={v.shared ?? false} />
      <div className="form-actions"><button type="submit">{t("Save")}</button></div>
    </ActionForm>
  );
}
