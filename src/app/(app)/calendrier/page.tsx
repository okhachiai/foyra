import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { addMonths } from "@/lib/amortization";
import { formatMonth, parseMonth } from "@/lib/budget";
import { getCalendar, type ChargeStatus } from "@/lib/calendar";
import { formatDay, frDate, monthLabel, parseDay, todayIn } from "@/lib/ledger";
import { formatCents } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { DateTile } from "@/components/ui/date-tile";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { MonthNav } from "@/components/ui/month-nav";
import { PageHeader } from "@/components/ui/page-header";
import { PayCharge } from "../charges/pay-form";

const dayLabel = (d: Date) => frDate({ weekday: "long", day: "numeric", month: "long" }).format(d);
const frDay = (d: Date) => formatDay(d).split("-").reverse().join("/");
const WEEKDAYS = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];
/** Codes couleur communs (tableau de bord, charges) : payée vert, à payer ambre, en retard corail. */
const STATUS: Record<ChargeStatus, ["success" | "warning" | "danger", string]> = { paid: ["success", "Payée"], due: ["warning", "À payer"], late: ["danger", "En retard"] };
const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? "s" : ""}`;

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const user = await requireUser();
  const todayStr = todayIn(user.household.timezone);
  const today = parseDay(todayStr)!;
  const month = parseMonth((await searchParams).m) ?? parseMonth(todayStr.slice(0, 7))!;
  const { days, upcoming, forecast } = await getCalendar(user.householdId, month, today);
  const money = (cents: number) => formatCents(cents, user.household.currency);
  const current = todayStr.startsWith(formatMonth(month));

  // Grille du mois : semaines du lundi au dimanche, cases vides avant le 1er.
  const byDay = new Map(days.map((d) => [formatDay(d.day), d]));
  const count = Math.round((addMonths(month, 1).getTime() - month.getTime()) / 86_400_000);
  const lead = (month.getUTCDay() + 6) % 7;
  const cells = [...Array<null>(lead).fill(null), ...Array.from({ length: count }, (_, i) => new Date(month.getTime() + i * 86_400_000))];

  return (
    <>
      <PageHeader
        eyebrow="Foyra / Calendrier"
        title="Calendrier"
        subtitle={`Échéances et opérations de ${monthLabel(month)}.`}
        actions={
          <>
            {!current && <Link href="/calendrier" className="button ghost">Aujourd’hui</Link>}
            <MonthNav path="/calendrier" month={month} />
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-8">
          <SectionHeader
            title={<span className="capitalize">{monthLabel(month)}</span>}
            subtitle={days.length ? `${plural(days.length, "jour")} avec des mouvements` : "Rien de prévu ce mois-ci"}
          />
          <div className="cal" role="table" aria-label={`Calendrier de ${monthLabel(month)}`}>
            <div className="cal-row" role="row">
              {WEEKDAYS.map((w) => <span key={w} role="columnheader" className="cal-head">{w}</span>)}
            </div>
            {Array.from({ length: Math.ceil(cells.length / 7) }, (_, w) => (
              <div key={w} className="cal-row" role="row">
                {Array.from({ length: 7 }, (_, i) => {
                  const d = cells[w * 7 + i];
                  if (!d) return <span key={i} role="cell" className="cal-cell is-out" />;
                  const k = formatDay(d);
                  const e = byDay.get(k);
                  const isToday = k === todayStr;
                  const dots = [
                    ...(e?.charges.map((c) => `dot-${c.status}`) ?? []),
                    ...(e?.transactions.map((t) => (t.kind === "INCOME" ? "dot-income" : "dot-expense")) ?? []),
                  ];
                  const summary = e && [e.charges.length && plural(e.charges.length, "échéance"), e.transactions.length && plural(e.transactions.length, "opération")].filter(Boolean).join(", ");
                  const body = (
                    <>
                      <span className="cal-num">{d.getUTCDate()}</span>
                      {dots.length > 0 && (
                        <span className="cal-dots" aria-hidden>
                          {dots.slice(0, 4).map((c, j) => <i key={j} className={c} />)}
                          {dots.length > 4 && <small>+{dots.length - 4}</small>}
                        </span>
                      )}
                      {e && <span className="cal-first">{e.charges[0]?.name ?? (e.transactions[0].note || e.transactions[0].category?.name || (e.transactions[0].kind === "INCOME" ? "Recette" : "Dépense"))}</span>}
                    </>
                  );
                  return (
                    <span key={i} role="cell" className={`cal-cell${isToday ? " is-today" : ""}`} aria-current={isToday ? "date" : undefined}>
                      {e ? <a href={`#j-${k}`} aria-label={`${dayLabel(d)} : ${summary}`}>{body}</a> : <span>{body}</span>}
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="ab-legend">
            <span><i className="dot-paid" />Échéance payée</span>
            <span><i className="dot-due" />À payer</span>
            <span><i className="dot-late" />En retard</span>
            <span><i className="dot-income" />Revenu</span>
            <span><i className="dot-expense" />Dépense</span>
          </div>
        </Card>

        <div className="flex flex-col gap-4 lg:col-span-4">
          <Card>
            <SectionHeader title="Paiements à venir" subtitle="7 prochains jours et retards du mois en cours" />
            {upcoming.length === 0 ? (
              <EmptyState title="Aucune échéance dans les 7 prochains jours" />
            ) : (
              <ul className="due-list">
                {upcoming.map((c) => (
                  <li key={`${c.id}-${formatDay(c.due)}`} className={c.status === "late" ? "is-late" : undefined}>
                    <Link href={c.loanId ? `/credits/${c.loanId}` : `/charges/${c.id}`}>
                      <DateTile date={c.due} />
                      <span className="min-w-0 flex-1">
                        <b className="block truncate text-heading">{c.name}</b>
                        <small className="block truncate text-label text-faint">{c.loanId ? "Crédit" : "Charge fixe"} · {frDay(c.due)}</small>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <b className="ab-num text-heading">{money(c.amount)}</b>
                        <Badge dot tone={STATUS[c.status][0]}>{STATUS[c.status][1]}</Badge>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {forecast && (
            <Card>
              <SectionHeader title="Prévision fin de mois" subtitle="Net des opérations du mois, échéances non payées déduites" />
              <dl className="facts-list">
                <div><dt>Net du mois</dt><dd className={forecast.net < 0 ? "text-neg" : undefined}>{money(forecast.net)}</dd></div>
                <div><dt>Échéances à payer</dt><dd>{money(forecast.unpaid ? -forecast.unpaid : 0)}</dd></div>
                <div className="is-total"><dt>Fin de mois</dt><dd className={forecast.end < 0 ? "text-neg" : "text-pos"}>{money(forecast.end)}</dd></div>
              </dl>
            </Card>
          )}
        </div>
      </div>

      <section className="mt-8" aria-labelledby="agenda">
        <h2 id="agenda" className="mt-0">Jour par jour</h2>
        {days.length === 0 && <EmptyState title="Rien de prévu ce mois-ci" />}
        <div className="flex flex-col gap-3">
          {days.map(({ day, charges, transactions }) => {
            const k = formatDay(day);
            const isToday = k === todayStr;
            return (
              <Card key={k} id={`j-${k}`} className={`agenda-day${isToday ? " is-today" : ""}`} aria-current={isToday ? "date" : undefined}>
                <SectionHeader title={<span className="capitalize">{dayLabel(day)}</span>} action={isToday && <Badge>Aujourd’hui</Badge>} />
                <ul className="due-list">
                  {charges.map((c) => {
                    const t = c.payment?.transaction;
                    const [tone, label] = STATUS[c.status];
                    return (
                      <li key={c.id} className={c.status === "late" ? "is-late" : undefined}>
                        <div className="due-row">
                          <span className="row-icon info" title="Échéance"><Icon name="calendar" className="size-4" /></span>
                          <span className="min-w-0 flex-1">
                            <Link href={c.loanId ? `/credits/${c.loanId}` : `/charges/${c.id}`} className="block truncate font-bold text-heading no-underline hover:underline">{c.name}</Link>
                            <small className="block text-label text-faint">{c.loanId ? "Échéance de crédit" : "Échéance"}</small>
                          </span>
                          <span className="flex shrink-0 flex-col items-end gap-1">
                            <b className="ab-num text-heading">{money(c.amount)}</b>
                            <Badge dot tone={tone}>{label}</Badge>
                          </span>
                        </div>
                        {t ? (
                          <p className="due-meta">Payée {money(t.amount)} le {frDay(t.occurredOn)} · <Link href={`/operations/${t.id}`}>voir la dépense</Link></p>
                        ) : (
                          <div className="due-meta"><PayCharge id={c.id} month={month} amount={c.amount} due={c.due} back="calendar" late={c.status === "late"} /></div>
                        )}
                      </li>
                    );
                  })}
                  {transactions.map((t) => {
                    const credit = t.kind === "INCOME";
                    const cat = t.category && `${t.category.parent ? `${t.category.parent.name} › ` : ""}${t.category.name}`;
                    const label = credit ? "Recette" : "Dépense";
                    return (
                      <li key={t.id}>
                        <Link href={`/operations/${t.id}`}>
                          <span className={`row-icon ${credit ? "" : "expense"}`} title={label}><Icon name={credit ? "arrowIn" : "arrowOut"} className="size-4" /></span>
                          <span className="min-w-0 flex-1">
                            <b className="block truncate text-heading">{t.note || cat || label}</b>
                            <small className="block truncate text-label text-faint">{[t.note || cat ? label : null, t.paidBy.name].filter(Boolean).join(" · ")}</small>
                          </span>
                          <b className={`ab-num shrink-0 ${credit ? "text-pos" : "text-neg"}`}>{credit ? "+" : "−"}{money(t.amount)}</b>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            );
          })}
        </div>
      </section>
    </>
  );
}
