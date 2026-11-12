import Link from "next/link";
import type { ReactNode } from "react";
import type { CategoryKind } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { budgetSeeds, formatMonth, getBudget, groupOf, incomeLines, itemSignature, parseMonth, type Group } from "@/lib/budget";
import { spendingPlan } from "@/lib/dashboard";
import { configuredProviders } from "@/lib/llm";
import { prisma } from "@/lib/db";
import { monthLabel, todayIn } from "@/lib/ledger";
import { getI18n } from "@/lib/i18n-server";
import { centsToInput, formatCents, formatWhole } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { MonthNav } from "@/components/ui/month-nav";
import { PageHeader } from "@/components/ui/page-header";
import { ProgressBar } from "@/components/ui/progress";
import { Stat } from "@/components/ui/stat";
import { budgetAction, createBudgetAction, importBudgetAction, planAction } from "@/app/actions";
import { ActionForm, Field } from "@/app/form";
import { Fold, SubFold } from "./fold";

/** Planned lines split by their category type (see groupOf); a line without a category is variable. English source labels. */
const SECTIONS: [Group, string][] = [
  ["income", "Income"],
  ["fixed", "Fixed charges"],
  ["savings", "Savings"],
  ["variable", "Variable expenses"],
];

/**
 * Columns of a budget line. Mobile: checkbox, label, planned; actual, gap and actions go below.
 * sm+: checkbox, label, planned, actual, gap, carry-over, actions — fixed widths, aligned despite sub-line indentation.
 */
const COLS = "grid-cols-[1.5rem_minmax(0,1fr)_7rem] items-center gap-x-3 lg:grid-cols-[1.5rem_minmax(0,1fr)_7.5rem_7rem_6.5rem_2rem_7.25rem]";

/** One-line form: ActionForm's borderless <fieldset> carries the layout. */
const ROW = "[&_fieldset]:m-0 [&_fieldset]:flex [&_fieldset]:min-w-0 [&_fieldset]:flex-wrap [&_fieldset]:items-center [&_fieldset]:gap-3 [&_fieldset]:border-0 [&_fieldset]:p-0";

type Budget = NonNullable<Awaited<ReturnType<typeof getBudget>>>;
type Line = Budget["tree"][number]["children"][number];

export default async function BudgetPage({ searchParams }: { searchParams: Promise<{ m?: string; ok?: string }> }) {
  const user = await requireUser();
  const { m, ok } = await searchParams;
  const { t, intl } = await getI18n();
  const today = todayIn(user.household.timezone);
  const month = parseMonth(m) ?? parseMonth(today.slice(0, 7))!;
  // Suggested date for entering actuals: today if the budget is the current month's, else the 1st of the month.
  const entryDay = today.startsWith(formatMonth(month)) ? today : `${formatMonth(month)}-01`;
  const budget = await getBudget(user.householdId, month);
  const money = (cents: number) => formatCents(cents, user.household.currency, intl);
  const label = monthLabel(month, intl);

  /** Header: title, status (subtitle), month export, month picker and budget actions. */
  const header = (subtitle: ReactNode, actions?: ReactNode) => (
    <PageHeader
      eyebrow={`Foyra / ${t("Budget")}`}
      title={t("Monthly budget")}
      subtitle={subtitle}
      actions={
        <>
          <a href={`/budget/export?m=${formatMonth(month)}`} download className="button ghost" aria-label={t("Export the month")}><Icon name="download" className="size-4" /><span className="max-sm:sr-only">{t("Export")}</span></a>
          <MonthNav path="/budget" month={month} />
          {actions}
        </>
      }
    />
  );

  /** Import of an exported file (budget, transactions, payments): the file's month is replaced as is. ADMIN only (touches the catalogue). */
  const transfer = user.role === "ADMIN" && (
    <ActionForm
      action={importBudgetAction}
      className={`card mt-6 p-4 ${ROW}`}
      confirm={t("Replace the budget and all transactions of the month contained in the file with those from the file?")}
    >
      <span className="text-label font-semibold text-heading">{t("Import an exported month")}</span>
      <label className="min-w-0 flex-1 basis-56">
        <span className="sr-only">{t("Month file to import (.json)")}</span>
        <input type="file" name="file" accept=".json,application/json" required className="cursor-pointer py-2 text-sm text-muted file:me-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-raised file:px-3 file:py-1 file:text-sm file:text-heading" />
      </label>
      <button type="submit" className="secondary">{t("Import")}</button>
    </ActionForm>
  );

  if (!budget) {
    const incomes = incomeLines(await budgetSeeds(prisma, user.householdId, month));
    return (
      <>
        {header(<>{t("No budget for {month}.", { month: label })}</>)}
        <EmptyState
          className="card"
          title={t("No budget for {month}", { month: label })}
          action={
            <ActionForm action={createBudgetAction}>
              <input type="hidden" name="month" value={formatMonth(month)} />
              <fieldset className="grid gap-2 border-0 p-0 [&_.field>span]:sr-only">
                <legend className="mb-2 font-medium">{t("Income for {month}", { month: label })}</legend>
                {[...incomes, ...Array(2).fill({ label: "", amount: 0, categoryId: null })].map((i, k) => (
                  <div key={k} className="grid grid-cols-[minmax(0,1fr)_8rem] gap-2">
                    <input type="hidden" name="inc:cat" value={i.categoryId ?? ""} />
                    <Field name={`inc:label:${k}`} label={t("Income label")}>
                      <input name="inc:label" defaultValue={i.label} maxLength={100} placeholder={t("Other income")} autoComplete="off" />
                    </Field>
                    <Field name={`inc:amount:${k}`} label={`${t("Amount")} · ${i.label || t("other income")}`}>
                      <input name="inc:amount" inputMode="decimal" defaultValue={i.amount ? centsToInput(i.amount) : ""} placeholder="0.00" autoComplete="off" className="text-end tabular-nums" />
                    </Field>
                  </div>
                ))}
              </fieldset>
              <button type="submit">{t("Create the budget for {month}", { month: label })}</button>
            </ActionForm>
          }
        >
          {t(user.household.budgetSource === "PREVIOUS"
            ? "It will carry over the last budget’s recurring lines (or, failing that, the category templates)."
            : "It will start from the category templates.")}{" "}
          {t("All planned amounts are entered here: they feed the dashboard, recurring charges and the split. The budget is a forecast: it creates no transactions.")}
        </EmptyState>
        {transfer}
      </>
    );
  }

  const draft = budget.status === "DRAFT";
  const { totals } = budget;
  const plan = spendingPlan(budget.tree);
  const overruns = plan.lines.filter((l) => l.left < 0);
  const used = plan.planned ? Math.round((plan.actual / plan.planned) * 100) : null;
  const round = (cents: number) => formatWhole(cents, user.household.currency, intl);
  const signed = (cents: number) => `${cents > 0 ? "+" : ""}${money(cents)}`;

  const currency = new Intl.NumberFormat(intl, { style: "currency", currency: user.household.currency }).formatToParts(0).find((x) => x.type === "currency")?.value;

  /**
   * An editable line: inclusion, label (+ actual/planned bar for expenses), amount (or computed total), actual, gap, carry-over, ↑/↓, removal.
   * Gap: planned − actual for an expense (negative = overspend), actual − planned for income.
   */
  const row = (i: Line, opts: { total?: number; child?: boolean; parentExcluded?: boolean; shared: boolean; first: boolean; last: boolean }) => {
    const p = `${i.id}:`;
    const computed = opts.total !== undefined;
    const flags = draft && !opts.child && i.kind === "EXPENSE";
    const income = i.kind === "INCOME";
    const planned = opts.total ?? i.amount;
    const gap = income ? i.actual - planned : planned - i.actual;
    return (
      <div key={i.id} className={`grid ${COLS} gap-y-1.5 border-t border-hairline py-2 [&_.field>span]:sr-only ${opts.child ? "ps-4 lg:ps-8" : ""} ${opts.parentExcluded || !i.included ? "opacity-60" : ""}`}>
        <input type="hidden" name="item" value={i.id} />
        <input type="hidden" name={`sig:${i.id}`} value={itemSignature(flags ? i : { ...i, shared: undefined, reserve: undefined })} />
        <label className="check" title={t("Include in the budget")}>
          <input type="checkbox" name={`${p}included`} defaultChecked={i.included} disabled={!draft} />
          <span className="sr-only">{t("Include")} · {i.label}</span>
        </label>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Field name={`${p}label`} label={t("Label")}>
            <input name={`${p}label`} defaultValue={i.label} maxLength={100} required readOnly={!draft} className={opts.child ? "" : "font-semibold"} />
          </Field>
          {!income && (planned > 0 || i.actual > 0) && <ProgressBar value={i.actual} max={planned} label={`${i.label}: ${t("Share of planned spent")}`} className="h-1" />}
        </div>
        {computed ? (
          <span className="amount px-3 text-end tabular-nums" title={t("Sum of included sub-lines")}>{centsToInput(opts.total!)}</span>
        ) : (
          <Field name={`${p}amount`} label={`${t("Planned amount")} · ${i.label}`}>
            <input name={`${p}amount`} inputMode="decimal" autoComplete="off" defaultValue={centsToInput(i.amount)} readOnly={!draft} className="text-end tabular-nums" />
          </Field>
        )}
        <div className="col-[2/-1] flex flex-wrap items-center gap-x-3 text-label lg:contents">
          {i.categoryId ? (
            <Link
              href={`/transactions/new?${new URLSearchParams({ kind: i.kind, cat: i.categoryId, d: entryDay, ...(opts.shared && { shared: "1" }), back: "budget" })}`}
              title={`${t("Enter a transaction")} · ${i.label}`}
              className="inline-flex items-center justify-end gap-1 text-muted tabular-nums hover:text-heading"
            >
              <span className="lg:hidden">{t("Actual")} </span>{money(i.actual)}<Icon name="plus" className="size-3.5" />
            </Link>
          ) : (
            <span className="text-muted tabular-nums lg:pe-[1.125rem] lg:text-end" title={t("No category: actual not tracked")}><span className="lg:hidden">{t("Actual")} </span>{money(i.actual)}</span>
          )}
          <span className={`tabular-nums lg:text-end ${!income && gap < 0 ? "font-semibold text-neg" : "text-muted"}`} title={t(income ? "Gap: actual − planned" : gap < 0 ? "Overspend: planned − actual" : "Remaining: planned − actual")}>
            <span className="sr-only">{t("Gap")} </span>{signed(gap)}
          </span>
          <label className="check ms-auto lg:ms-0" title={t("Carry over to next month")}>
            <input type="checkbox" name={`${p}recurring`} defaultChecked={i.recurring} disabled={!draft} />
            <span aria-hidden className="text-xs text-muted">↻</span>
            <span className="sr-only">{t("Carry over")} · {i.label}</span>
          </label>
          {draft ? (
            <span className="flex justify-end gap-1">
              <button type="submit" name="op" value={`move:up:${i.id}`} disabled={opts.first} className="ghost min-h-9 w-9 px-0 max-sm:hidden" aria-label={t("Move “{label}” up", { label: i.label })}>↑</button>
              <button type="submit" name="op" value={`move:down:${i.id}`} disabled={opts.last} className="ghost min-h-9 w-9 px-0 max-sm:hidden" aria-label={t("Move “{label}” down", { label: i.label })}>↓</button>
              <button
                type="submit" name="op" value={`remove:${i.id}`} className="ghost min-h-9 w-9 px-0 hover:text-neg" aria-label={t("Remove “{label}”", { label: i.label })}
                data-confirm={t(computed ? "Remove “{label}” and its sub-lines?" : "Remove “{label}”?", { label: i.label })}
              >
                ×
              </button>
            </span>
          ) : (
            <span className="hidden lg:block" />
          )}
        </div>
      </div>
    );
  };

  /** "Shared" / "Reserve" checkboxes: top-level expense lines, draft only (shown on the expander row). */
  const flagsOf = (i: Line) =>
    draft && i.kind === "EXPENSE" && (
      <span className="flex gap-x-4">
        <input type="hidden" name={`${i.id}:flags`} value="1" />
        <label className="check min-h-8 font-medium" title={t("Shared expense, split in proportion to income")}>
          <input type="checkbox" name={`${i.id}:shared`} defaultChecked={i.shared} className="size-4!" />
          <span>{t("Shared")}<span className="sr-only"> · {i.label}</span></span>
        </label>
        <label className="check min-h-8 font-medium" title={t("Contingency reserve: absorbs envelope overspends")}>
          <input type="checkbox" name={`${i.id}:reserve`} defaultChecked={i.reserve} className="size-4!" />
          <span>{t("Reserve")}<span className="sr-only"> · {i.label}</span></span>
        </label>
      </span>
    );

  /** Fields to add a line (`target` = type or parent line). */
  const adder = (target: string, text: string) => (
    <div className="grid grid-cols-[minmax(0,1fr)_7rem] items-end gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_auto] [&_.field>span]:sr-only">
      <Field name={`new:${target}:label`} label={`${t("Label")} · ${text}`}>
        <input name={`new:${target}:label`} maxLength={100} placeholder={text} autoComplete="off" />
      </Field>
      <Field name={`new:${target}:amount`} label={`${t("Amount")} · ${text}`}>
        <input name={`new:${target}:amount`} inputMode="decimal" placeholder="0.00" autoComplete="off" className="text-end" />
      </Field>
      <button type="submit" name="op" value={`add:${target}`} className="secondary col-span-2 sm:col-span-1"><Icon name="plus" className="size-4" />{t("Add")}</button>
    </div>
  );

  /** Column header (sm+ only: on mobile each value carries its label). */
  const columns = (
    <div aria-hidden className={`hidden ${COLS} pb-1 text-micro font-semibold uppercase tracking-wide text-faint lg:grid`}>
      <span />
      <span>{t("Label")}</span>
      <span className="pe-3 text-end">{t("Planned")} ({currency})</span>
      <span className="pe-[1.125rem] text-end">{t("Actual")}</span>
      <span className="text-end">{t("Gap")}</span>
      <span title={t("Carried over to next month")}>↻</span>
      <span />
    </div>
  );

  /** Form section: a group's planned lines (see SECTIONS), collapsible subcategories. */
  const section = ([group, title]: [Group, string]) => {
    const kind: CategoryKind = group === "income" ? "INCOME" : "EXPENSE";
    const nodes = budget.tree.filter((n) => groupOf(n) === group);
    const total = totals[group];
    const actual = nodes.reduce((s, n) => s + (n.included ? n.actual : 0), 0);
    return (
      <Fold
        key={title}
        id={group}
        title={t(title)}
        aside={
          <span className="self-center text-label text-muted tabular-nums">
            {t("Actual")} <b className="text-heading">{money(actual)}</b> / <b className="text-heading">{money(total)}</b>
          </span>
        }
      >
        {nodes.length === 0 ? (
          <p className="m-0 text-sm text-muted">
            {/* Only savings can have a total without lines: it also counts the month's deposits. */}
            {total > 0 ? t("No planned line, {amount} already paid in this month.", { amount: money(total) }) : t("No lines.")}
          </p>
        ) : (
          <div>
            {columns}
            {nodes.map((n, k) => (
              <div key={n.id}>
                {row(n, { total: n.children.length ? n.total : undefined, shared: n.shared, first: k === 0, last: k === nodes.length - 1 })}
                {(n.children.length > 0 || draft) && (
                  <SubFold
                    id={n.categoryId ?? n.label}
                    summary={
                      n.children.length ? (
                        <>{n.children.length}<span className="max-sm:hidden"> {t(n.children.length > 1 ? "subcategories" : "subcategory")}</span><span className="sm:hidden"> {t("subcat.")}</span></>
                      ) : (
                        <><span className="max-sm:hidden">{t("Add a subcategory")}</span><span className="sm:hidden">+ {t("subcat.")}</span></>
                      )
                    }
                    aside={flagsOf(n)}
                  >
                    {n.children.map((c, j) => row(c, { child: true, parentExcluded: !n.included, shared: n.shared, first: j === 0, last: j === n.children.length - 1 }))}
                    {draft && <div className="py-2 ps-4 sm:ps-8">{adder(n.id, t("New subcategory of “{label}”", { label: n.label }))}</div>}
                  </SubFold>
                )}
              </div>
            ))}
          </div>
        )}
        {/* A new line has no category: it joins the variable expenses. */}
        {draft && (group === "income" || group === "variable") && <div className="border-t border-hairline pt-3">{adder(kind, t(kind === "INCOME" ? "New income line" : "New expense line"))}</div>}
      </Fold>
    );
  };

  return (
    <>
      {header(
        <span className="inline-flex flex-wrap items-center gap-2">
          <Badge dot tone={draft ? "warning" : "success"}>{t(draft ? "Draft" : "Validated")}</Badge>
          {label.replace(/^./, (c) => c.toUpperCase())} · {t(draft ? "lines editable until validation" : "read-only lines")}
        </span>,
        <ActionForm action={budgetAction} className="inline">
          <input type="hidden" name="month" value={formatMonth(month)} />
          <input type="hidden" name="budgetId" value={budget.id} />
          {draft ? (
            <button type="submit" name="op" value="status:VALIDATED">{t("Validate the budget")}</button>
          ) : (
            <button type="submit" name="op" value="status:DRAFT" className="secondary border-warn/40 text-warn">{t("Back to draft")}</button>
          )}
        </ActionForm>,
      )}
      {ok && <p role="status" className="alert success mb-4"><Icon name="shield" className="mt-0.5 size-4 shrink-0" />{t("Budget saved.")}</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t("Planned income")} value={round(totals.income)} />
        <Stat label={t("Planned spending")} value={round(totals.fixed + totals.variable)} note={t("Fixed {fixed} · var. {variable}", { fixed: round(totals.fixed), variable: round(totals.variable) })} />
        <Stat label={t("Planned savings")} value={round(totals.savings)} />
        <Stat label={t("Planned remainder")} value={round(totals.remaining)} tone={totals.remaining < 0 ? "neg" : undefined} note={t("Income − spending − savings")} />
      </div>

      <Card className="mt-4">
        <SectionHeader
          title={t("Spending tracking")}
          subtitle={t("Actual / planned, fixed and variable expenses included")}
          action={used !== null && <Badge tone={used > 100 ? "danger" : used > 90 ? "warning" : "success"}>{t("{pct}% used", { pct: used })}</Badge>}
        />
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-label text-muted">
          <span><b className="text-section text-heading tabular-nums">{money(plan.actual)}</b> {t("spent of {amount}", { amount: money(plan.planned) })}</span>
          <b className={`tabular-nums ${plan.left < 0 ? "text-neg" : "text-heading"}`}>{plan.left < 0 ? t("Over by {amount}", { amount: money(-plan.left) }) : t("{amount} left", { amount: money(plan.left) })}</b>
        </div>
        <ProgressBar value={plan.actual} max={plan.planned} label={t("Actual vs planned spending")} />
        {overruns.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-label font-semibold text-neg">{t(overruns.length > 1 ? "{n} overspends" : "{n} overspend", { n: overruns.length })}</span>
            {overruns.map((l) => <Badge key={l.id} tone="danger">{l.label} · +{money(-l.left)}</Badge>)}
          </div>
        )}
      </Card>

      {draft && configuredProviders(user.household).length > 0 && (
        <ActionForm action={planAction} className={`card mt-4 p-4 ${ROW} [&_fieldset]:justify-between`} pendingNotice={t("The AI is preparing the allocation… this can take a few minutes with a local model.")}>
          <input type="hidden" name="month" value={formatMonth(month)} />
          <p className="m-0 min-w-0 flex-1 basis-64 text-sm text-muted">
            {t("Income, fixed charges and savings entered? The AI allocates the remaining {amount} across variable expenses.", { amount: money(Math.max(totals.income - totals.fixed - totals.savings, 0)) })}
          </p>
          <small className="text-muted">{t("Save budget changes before requesting an allocation.")}</small>
          <button type="submit" className="secondary"><Icon name="reports" className="size-4" />{t("Suggest the allocation")}</button>
        </ActionForm>
      )}

      {/* Fresh key on each server render: after a successful save, fields restart from the stored values. */}
      <ActionForm action={budgetAction} key={crypto.randomUUID()} className="mt-4 [&>fieldset]:m-0 [&>fieldset]:flex [&>fieldset]:min-w-0 [&>fieldset]:flex-col [&>fieldset]:gap-4 [&>fieldset]:border-0 [&>fieldset]:p-0">
        {/* Default button (Enter key): save. */}
        {draft && <button type="submit" name="op" value="save" hidden tabIndex={-1} aria-hidden />}
        <input type="hidden" name="month" value={formatMonth(month)} />
        <input type="hidden" name="budgetId" value={budget.id} />
        {SECTIONS.map(section)}
        {draft && <button type="submit" name="op" value="save" className="self-start">{t("Save the budget")}</button>}
      </ActionForm>
      {transfer}
    </>
  );
}
