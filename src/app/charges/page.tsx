import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { addMonths, formatMonth, parseMonth } from "@/lib/budget";
import { listMonthCharges } from "@/lib/charges";
import { formatDay, todayIn } from "@/lib/ledger";
import { centsToInput, formatCents } from "@/lib/money";
import { payChargeAction } from "../actions";
import { ActionForm, Field } from "../form";

const monthLabel = (month: Date) => new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(month);
const frDay = (d: Date) => formatDay(d).split("-").reverse().join("/");

export default async function ChargesPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const user = await requireUser();
  const month = parseMonth((await searchParams).m) ?? parseMonth(todayIn(user.household.timezone).slice(0, 7))!;
  const charges = await listMonthCharges(user.householdId, month);
  const money = (cents: number) => formatCents(cents, user.household.currency);
  const total = charges.reduce((s, c) => s + c.amount, 0);
  const unpaid = charges.reduce((s, c) => s + (c.payment ? 0 : c.amount), 0);
  const m = formatMonth(month);
  const lastDay = formatDay(new Date(addMonths(month, 1).getTime() - 86_400_000));

  return (
    <>
      <nav className="pager">
        <Link href={`/charges?m=${formatMonth(addMonths(month, -1))}`}>← Précédent</Link>
        <h1>Charges · {monthLabel(month)}</h1>
        <Link href={`/charges?m=${formatMonth(addMonths(month, 1))}`}>Suivant →</Link>
      </nav>

      <section className="total">
        <span className="muted">Charges fixes du mois</span>
        <strong>{money(total)}</strong>
        <dl className="totals">
          <dt>Payées</dt><dd>{money(total - unpaid)}</dd>
          <dt>À payer</dt><dd>{money(unpaid)}</dd>
        </dl>
      </section>

      <div className="row">
        <h2>Échéances</h2>
        <Link href="/charges/new" className="button secondary">Ajouter</Link>
      </div>
      {charges.length === 0 && <p className="muted">Aucune charge fixe pour ce mois.</p>}
      <ul className="list">
        {charges.map((c) => {
          const t = c.payment?.transaction;
          return (
            <li key={c.id}>
              <div className="budget-line">
                <div className="row">
                  <span>
                    <Link href={`/charges/${c.id}`}>{c.name}</Link>
                    <small className="muted">
                      Échéance {frDay(c.due)} · {c.account.name} · {c.category.parent ? `${c.category.parent.name} › ` : ""}{c.category.name}
                    </small>
                  </span>
                  <span className="amount">{money(c.amount)}</span>
                </div>
                {t ? (
                  <small>
                    <span className="pos">Payée</span> · {money(t.amount)} le {frDay(t.occurredOn)} ·{" "}
                    <Link href={`/accounts/${t.accountId}/transactions/${t.id}`}>voir la dépense</Link>
                  </small>
                ) : (
                  <details>
                    <summary><span className="neg">À payer</span> · Marquer payée</summary>
                    <ActionForm action={payChargeAction}>
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="month" value={m} />
                      <Field name="amount" label="Montant">
                        <input name="amount" inputMode="decimal" required autoComplete="off" defaultValue={centsToInput(c.amount)} />
                      </Field>
                      <Field name="occurredOn" label="Date">
                        <input name="occurredOn" type="date" required min={`${m}-01`} max={lastDay} defaultValue={formatDay(c.due)} />
                      </Field>
                      <button type="submit">Marquer payée</button>
                    </ActionForm>
                  </details>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
