import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { addMonths, formatMonth, parseMonth } from "@/lib/budget";
import { getCalendar, type ChargeStatus } from "@/lib/calendar";
import { formatDay, parseDay, todayIn } from "@/lib/ledger";
import { centsToInput, formatCents } from "@/lib/money";
import { payChargeAction } from "../actions";
import { ActionForm, Field } from "../form";

const monthLabel = (month: Date) => new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(month);
const dayLabel = (d: Date) => new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(d);
const frDay = (d: Date) => formatDay(d).split("-").reverse().join("/");
const STATUS: Record<ChargeStatus, [string, string]> = { paid: ["pos", "Payée"], late: ["neg", "En retard"], due: ["muted", "À payer"] };

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const user = await requireUser();
  const todayStr = todayIn(user.household.timezone);
  const today = parseDay(todayStr)!;
  const month = parseMonth((await searchParams).m) ?? parseMonth(todayStr.slice(0, 7))!;
  const { days, upcoming, forecast } = await getCalendar(user.householdId, month, today);
  const money = (cents: number) => formatCents(cents, user.household.currency);
  const m = formatMonth(month);
  const lastDay = formatDay(new Date(addMonths(month, 1).getTime() - 86_400_000));

  return (
    <>
      <nav className="pager">
        <Link href={`/calendrier?m=${formatMonth(addMonths(month, -1))}`}>← Précédent</Link>
        <h1>Calendrier · {monthLabel(month)}</h1>
        <Link href={`/calendrier?m=${formatMonth(addMonths(month, 1))}`}>Suivant →</Link>
      </nav>

      <h2>À venir</h2>
      {upcoming.length === 0 ? (
        <p className="muted">Aucune échéance dans les 7 prochains jours.</p>
      ) : (
        <ul className="list">
          {upcoming.map((c) => (
            <li key={`${c.id}-${formatDay(c.due)}`}>
              <div>
                <span>
                  <Link href={`/charges/${c.id}`}>{c.name}</Link>
                  <small className={STATUS[c.status][0]}>{STATUS[c.status][1]} · {frDay(c.due)}</small>
                </span>
                <span className="amount">{money(c.amount)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {forecast && (
        <section className="total">
          <span className="muted">Solde prévisionnel fin de mois (échéances non payées déduites)</span>
          <dl className="totals">
            {forecast.map((a) => (
              <div key={a.id} style={{ display: "contents" }}>
                <dt>{a.name}</dt>
                <dd>{money(a.balance)} → <b className={a.end < 0 ? "neg" : undefined}>{money(a.end)}</b></dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {days.length === 0 && <p className="muted">Rien de prévu ce mois-ci.</p>}
      {days.map(({ day, charges, transactions }) => {
        const isToday = formatDay(day) === todayStr;
        return (
          <section key={formatDay(day)} className={isToday ? "today" : undefined} aria-current={isToday ? "date" : undefined}>
            <h2>{dayLabel(day)}{isToday && <span className="badge">Aujourd’hui</span>}</h2>
            <ul className="list">
              {charges.map((c) => {
                const t = c.payment?.transaction;
                const [cls, label] = STATUS[c.status];
                return (
                  <li key={c.id}>
                    <div className="budget-line">
                      <div className="row">
                        <span>
                          <Link href={`/charges/${c.id}`}>{c.name}</Link>
                          <small className="muted">Échéance · {c.account.name}</small>
                        </span>
                        <span className="amount">{money(c.amount)}</span>
                      </div>
                      {t ? (
                        <small>
                          <span className={cls}>{label}</span> · {money(t.amount)} le {frDay(t.occurredOn)} ·{" "}
                          <Link href={`/accounts/${t.accountId}/transactions/${t.id}`}>voir la dépense</Link>
                        </small>
                      ) : (
                        <details>
                          <summary><span className={cls}>{label}</span> · Marquer payée</summary>
                          <ActionForm action={payChargeAction}>
                            <input type="hidden" name="id" value={c.id} />
                            <input type="hidden" name="month" value={m} />
                            <input type="hidden" name="back" value="calendar" />
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
              {transactions.map((t) => {
                const credit = t.kind === "INCOME" || t.transferSide === "IN";
                const cat = t.category && `${t.category.parent ? `${t.category.parent.name} › ` : ""}${t.category.name}`;
                const label = t.kind === "TRANSFER" ? `Virement vers ${t.toAccount ?? "?"}` : t.kind === "INCOME" ? "Recette" : "Dépense";
                const content = (
                  <>
                    <span>
                      {t.note || cat || label}
                      <small className="muted">{[t.account.name, t.note || cat ? label : null].filter(Boolean).join(" · ")}</small>
                    </span>
                    <span className={credit ? "amount pos" : "amount"}>{money(credit ? t.amount : -t.amount)}</span>
                  </>
                );
                // Compte archivé : opération en lecture seule, comme sur la page du compte.
                return <li key={t.id}>{t.account.archivedAt ? <div>{content}</div> : <Link href={`/accounts/${t.accountId}/transactions/${t.id}`}>{content}</Link>}</li>;
              })}
            </ul>
          </section>
        );
      })}
    </>
  );
}
