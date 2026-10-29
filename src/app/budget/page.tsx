import Link from "next/link";
import type { CategoryKind } from "@prisma/client";
import { getScope } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { addMonths, formatMonth, available, getBudget, parseMonth, type BudgetRow } from "@/lib/budget";
import { todayIn } from "@/lib/ledger";
import { centsToInput, formatCents } from "@/lib/money";
import { saveBudgetAction } from "../actions";
import { ActionForm, Field } from "../form";

const monthLabel = (month: Date) => new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(month);

export default async function BudgetPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const user = await requireUser();
  const currency = user.household.currency;
  const month = parseMonth((await searchParams).m) ?? parseMonth(todayIn(user.household.timezone).slice(0, 7))!;
  const { rows, totals, outside } = await getBudget(await getScope(user), month);
  const money = (cents: number) => formatCents(cents, currency);

  const line = (r: BudgetRow) => {
    const left = available(r);
    const loaded = r.planned != null ? centsToInput(r.planned) : "";
    return (
      <li key={r.id}>
        <div className="budget-line">
          <Field name={`planned:${r.id}`} label={r.label}>
            <input
              name={`planned:${r.id}`} inputMode="decimal" autoComplete="off" placeholder="à saisir"
              defaultValue={loaded}
            />
          </Field>
          <input type="hidden" name={`orig:${r.id}`} value={loaded} />
          {r.kind === "EXPENSE" ? (
            <small className="muted">
              Effectué {money(r.actual)} · Disponible <span className={left < 0 ? "neg" : undefined}>{money(left)}</span>
            </small>
          ) : (
            <small className="muted">Perçu {money(r.actual)}</small>
          )}
        </div>
      </li>
    );
  };

  const section = (kind: CategoryKind, title: string) => (
    <section>
      <h2>{title}</h2>
      {!rows.some((r) => r.kind === kind) && <p className="muted">Aucune catégorie incluse.</p>}
      <ul className="list">{rows.filter((r) => r.kind === kind).map(line)}</ul>
    </section>
  );

  return (
    <>
      <nav className="pager">
        <Link href={`/budget?m=${formatMonth(addMonths(month, -1))}`}>← Précédent</Link>
        <h1>{monthLabel(month)}</h1>
        <Link href={`/budget?m=${formatMonth(addMonths(month, 1))}`}>Suivant →</Link>
      </nav>

      <section className="total">
        <span className="muted">Reste à vivre</span>
        <strong className={totals.restToLive < 0 ? "neg" : undefined}>{money(totals.restToLive)}</strong>
        <small className="muted">Revenus max(prévu, perçu) − dépenses max(prévu, effectué + charges fixes à payer)</small>
        <dl className="totals">
          <dt>Revenus prévus / perçus</dt><dd>{money(totals.incomePlanned)} / {money(totals.incomeActual)}</dd>
          <dt>Dépenses prévues / effectuées</dt><dd>{money(totals.expensePlanned)} / {money(totals.expenseActual)}</dd>
          <dt>Restant à payer</dt><dd>{money(totals.remainingToPay)}</dd>
          <dt><Link href={`/charges?m=${formatMonth(month)}`}>Charges fixes</Link></dt>
          <dd>{money(totals.fixedTotal)} dont {money(totals.fixedRemaining)} à payer</dd>
          <dt>Dépenses variables effectuées</dt><dd>{money(totals.variableActual)}</dd>
        </dl>
      </section>
      {(outside.EXPENSE > 0 || outside.INCOME > 0) && (
        <p className="muted">
          Hors budget (sans catégorie ou catégorie exclue) : dépenses {money(outside.EXPENSE)}, recettes {money(outside.INCOME)}.
        </p>
      )}

      <ActionForm action={saveBudgetAction} key={formatMonth(month)}>
        <input type="hidden" name="month" value={formatMonth(month)} />
        {section("INCOME", "Revenus")}
        {section("EXPENSE", "Dépenses")}
        <button type="submit">Enregistrer</button>
      </ActionForm>
    </>
  );
}
