import Link from "next/link";
import { notFound } from "next/navigation";
import { canWrite, getScope } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { formatMonth } from "@/lib/budget";
import { listCategories } from "@/lib/categories";
import { formatDay, NotFoundError, parseDay, todayIn, writableAccounts } from "@/lib/ledger";
import { getLoan } from "@/lib/loans";
import { formatCents } from "@/lib/money";
import { deleteLoanAction, prepayLoanAction } from "../../actions";
import { ActionForm, Field } from "../../form";
import { LoanForm, monthYear, rateToInput } from "../loan-form";

const frDay = (d: Date) => formatDay(d).split("-").reverse().join("/");

export default async function LoanPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const todayStr = todayIn(user.household.timezone);
  const today = parseDay(todayStr)!;
  const scope = await getScope(user);
  const loan = await getLoan(scope, (await params).id, today).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const c = loan.fixedCharge;
  const editable = canWrite(scope, c.accountId);
  const [accounts, categories] = await Promise.all([
    // Le compte actuel reste affiché même archivé : l'enregistrement demandera d'en choisir un autre.
    writableAccounts(scope, c.accountId),
    listCategories(user.householdId),
  ]);
  const money = (cents: number) => formatCents(cents, user.household.currency);
  const { rows } = loan.schedule;
  const paid = new Map(c.payments.map((p) => [p.month.getTime(), p]));
  const next = rows.find((r) => r.due >= today);

  return (
    <>
      <p><Link href="/credits">← Crédits</Link></p>
      <h1>{c.name}</h1>

      <section className="total">
        <span className="muted">Capital restant dû au {frDay(today)}</span>
        <strong>{money(loan.status.balance)}</strong>
        <dl className="totals">
          <dt>Capital emprunté</dt><dd>{money(loan.principal)}</dd>
          <dt>Taux annuel</dt><dd>{rateToInput(loan.annualRate)} %</dd>
          <dt>Prochaine échéance</dt><dd>{next ? `${money(next.total)} le ${frDay(next.due)}` : "—"}</dd>
          {loan.insurance > 0 && <><dt>dont assurance</dt><dd>{money(loan.insurance)}</dd></>}
          <dt>Intérêts payés</dt><dd>{money(loan.status.interestPaid)}</dd>
          <dt>Intérêts restants</dt><dd>{money(loan.status.interestRemaining)}</dd>
          <dt>Fin</dt><dd>{rows.length ? monthYear(rows.at(-1)!.month) : "—"}</dd>
        </dl>
      </section>

      {!editable && <p className="muted">Accès en lecture seule sur le compte de ce crédit.</p>}
      {editable && <details>
        <summary>Remboursement anticipé</summary>
        <ActionForm action={prepayLoanAction}>
          <input type="hidden" name="id" value={loan.id} />
          <Field name="amount" label="Montant">
            <input name="amount" inputMode="decimal" required placeholder="0,00" autoComplete="off" />
          </Field>
          <Field name="occurredOn" label="Date">
            <input name="occurredOn" type="date" required defaultValue={todayStr} />
          </Field>
          <Field name="mode" label="Effet">
            <select name="mode" defaultValue="REDUCE_TERM">
              <option value="REDUCE_TERM">Réduire la durée (mensualité inchangée)</option>
              <option value="REDUCE_PAYMENT">Réduire la mensualité (fin inchangée)</option>
            </select>
          </Field>
          <p className="muted"><small>Crée la dépense sur {c.name} : supprimer cette dépense annule le remboursement.</small></p>
          <button type="submit">Enregistrer le remboursement</button>
        </ActionForm>
      </details>}

      {loan.prepayments.length > 0 && (
        <>
          <h2>Remboursements anticipés</h2>
          <ul className="list">
            {loan.prepayments.map((p) => (
              <li key={p.id}>
                {editable ? (
                  <Link href={`/accounts/${p.transaction.accountId}/transactions/${p.transaction.id}`}>
                    <span>
                      {frDay(p.transaction.occurredOn)}
                      <small className="muted">{p.mode === "REDUCE_TERM" ? "Réduction de durée" : "Réduction de mensualité"} · voir la dépense</small>
                    </span>
                    <span className="amount">{money(p.transaction.amount)}</span>
                  </Link>
                ) : (
                  <div>
                    <span>
                      {frDay(p.transaction.occurredOn)}
                      <small className="muted">{p.mode === "REDUCE_TERM" ? "Réduction de durée" : "Réduction de mensualité"}</small>
                    </span>
                    <span className="amount">{money(p.transaction.amount)}</span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <h2>Tableau d’amortissement</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr><th>N°</th><th>Date</th><th>Échéance</th><th>Intérêts</th><th>Capital restant</th><th>Statut</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.n}>
                <td>{r.n}</td>
                <td>{frDay(r.due)}</td>
                <td>{money(r.total)}</td>
                <td>{money(r.interest)}</td>
                <td>{money(r.balance)}</td>
                <td>
                  <Link href={`/charges?m=${formatMonth(r.month)}`} className={paid.has(r.month.getTime()) ? "pos" : "neg"}>
                    {paid.has(r.month.getTime()) ? "Payée" : "À payer"}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editable && <details>
        <summary>Modifier le crédit</summary>
        <LoanForm loan={loan} accounts={accounts} categories={categories} firstDue="" />
      </details>}

      {editable && <ActionForm
        action={deleteLoanAction} className="danger-zone"
        confirm="Supprimer ce crédit ? Les dépenses déjà payées et les remboursements anticipés sont conservés comme dépenses."
      >
        <input type="hidden" name="id" value={loan.id} />
        <button type="submit" className="danger">Supprimer</button>
      </ActionForm>}
    </>
  );
}
