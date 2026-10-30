import Link from "next/link";
import { getScope } from "@/lib/access";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { addMonths, formatMonth, parseMonth } from "@/lib/budget";
import { listMonthCharges } from "@/lib/charges";
import { formatDay, todayIn } from "@/lib/ledger";
import { centsToInput, formatCents } from "@/lib/money";
import { payChargeAction } from "../actions";
import { ActionForm, Field } from "../form";
import { SettingsNav } from "../nav";

const monthLabel = (month: Date) => new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(month);
const frDay = (d: Date) => formatDay(d).split("-").reverse().join("/");

export default async function ChargesPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const user = await requireUser();
  const month = parseMonth((await searchParams).m) ?? parseMonth(todayIn(user.household.timezone).slice(0, 7))!;
  const scope = await getScope(user);
  const [charges, inactive] = await Promise.all([
    listMonthCharges(scope, month),
    prisma.fixedCharge.findMany({ where: { householdId: user.householdId, active: false }, orderBy: { name: "asc" } }),
  ]);
  const money = (cents: number) => formatCents(cents, user.household.currency);
  const sum = (unpaidOnly = false) => charges.reduce((s, c) => s + (unpaidOnly && c.payment ? 0 : c.amount), 0);
  const m = formatMonth(month);
  const lastDay = formatDay(new Date(addMonths(month, 1).getTime() - 86_400_000));

  return (
    <>
      <nav className="pager">
        <Link href={`/charges?m=${formatMonth(addMonths(month, -1))}`}>← Précédent</Link>
        <h1>Récurrences · {monthLabel(month)}</h1>
        <Link href={`/charges?m=${formatMonth(addMonths(month, 1))}`}>Suivant →</Link>
      </nav>

      <SettingsNav admin={user.role === "ADMIN"} />
      <p className="muted">Échéances indicatives : rien n’est payé automatiquement. « Marquer payée » enregistre l’opération réelle. Montants lus dans le budget du mois (ligne de même catégorie).</p>
      <section className="total">
        <span className="muted">Dépenses récurrentes du mois</span>
        <strong>{money(sum())}</strong>
        <dl className="totals">
          <dt>Dont à payer</dt><dd>{money(sum(true))}</dd>
        </dl>
      </section>

      <div className="row">
        <h2>Échéances</h2>
        <Link href="/charges/new" className="button secondary">Ajouter</Link>
      </div>
      {charges.length === 0 && <p className="muted">Aucune récurrence active pour ce mois.</p>}
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
                      Échéance {frDay(c.due)} · {c.category.parent ? `${c.category.parent.name} › ` : ""}{c.category.name}
                    </small>
                  </span>
                  <span className="amount">{c.budgeted ? money(c.amount) : <small className="muted">Absente du budget</small>}</span>
                </div>
                {t ? (
                  <small>
                    <span className="pos">Payée</span> · {money(t.amount)} le {frDay(t.occurredOn)}
                    {" · "}<Link href={`/operations/${t.id}`}>voir l’opération</Link>
                  </small>
                ) : (
                  <details>
                    <summary><span className="neg">À payer</span> · Marquer payée</summary>
                    <ActionForm action={payChargeAction}>
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="month" value={m} />
                      <Field name="amount" label="Montant">
                        <input name="amount" inputMode="decimal" required autoComplete="off" defaultValue={c.amount ? centsToInput(c.amount) : ""} />
                      </Field>
                      <Field name="occurredOn" label="Date">
                        <input name="occurredOn" type="date" required min={`${m}-01`} max={lastDay} defaultValue={formatDay(c.due)} />
                      </Field>
                      <button type="submit">Enregistrer la dépense</button>
                    </ActionForm>
                  </details>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {inactive.length > 0 && (
        <details>
          <summary>Récurrences désactivées ({inactive.length})</summary>
          <ul className="list">
            {inactive.map((c) => (
              <li key={c.id}>
                <Link href={`/charges/${c.id}`}><span>{c.name}<small className="muted">Le {c.dueDay}</small></span></Link>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
