import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { parseMonth } from "@/lib/budget";
import { chargeStatus } from "@/lib/calendar";
import { listMonthCharges } from "@/lib/charges";
import { formatDay, parseDay, todayIn } from "@/lib/ledger";
import { formatCents } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { DateTile } from "@/components/ui/date-tile";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { MonthNav } from "@/components/ui/month-nav";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { SettingsNav } from "@/app/nav";
import { PayCharge } from "./pay-form";

const monthLabel = (month: Date) => new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(month);
const frDay = (d: Date) => formatDay(d).split("-").reverse().join("/");
const STATUS = { paid: ["success", "Payée"], due: ["warning", "À payer"], late: ["danger", "En retard"] } as const;

export default async function ChargesPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const user = await requireUser();
  const todayStr = todayIn(user.household.timezone);
  const today = parseDay(todayStr)!;
  const month = parseMonth((await searchParams).m) ?? parseMonth(todayStr.slice(0, 7))!;
  const [list, inactive] = await Promise.all([
    listMonthCharges(user.householdId, month),
    prisma.fixedCharge.findMany({ where: { householdId: user.householdId, active: false }, orderBy: { name: "asc" } }),
  ]);
  const charges = list.map((c) => ({ ...c, status: chargeStatus(c, today) }));
  const money = (cents: number) => formatCents(cents, user.household.currency);
  const sum = (unpaidOnly = false) => charges.reduce((s, c) => s + (unpaidOnly && c.payment ? 0 : c.amount), 0);
  const late = charges.filter((c) => c.status === "late");
  const paidCount = charges.filter((c) => c.payment).length;

  return (
    <>
      <PageHeader
        eyebrow="Paramètres / Récurrences"
        title="Charges récurrentes"
        subtitle={`Échéances de ${monthLabel(month)}. Indicatives : rien n’est payé automatiquement.`}
        actions={
          <>
            <MonthNav path="/charges" month={month} />
            <Link href="/charges/new" className="button"><Icon name="plus" className="size-4" />Ajouter</Link>
          </>
        }
      />
      <SettingsNav admin={user.role === "ADMIN"} />

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <Stat label="Dépenses récurrentes du mois" value={money(sum())} note="Montants lus dans le budget du mois" />
        <Stat label="Reste à payer" value={money(sum(true))} tone={sum(true) > 0 ? "neg" : undefined} note={`${charges.length - paidCount} échéance${charges.length - paidCount > 1 ? "s" : ""} non payée${charges.length - paidCount > 1 ? "s" : ""}`} />
        <Stat label="Payées" value={`${paidCount} / ${charges.length}`} tone="pos" note="Opérations réelles enregistrées" />
      </div>

      {late.length > 0 && (
        <div role="alert" className="alert danger mb-4">
          <Icon name="alert" className="size-5 shrink-0" />
          <p className="m-0">
            <b>{late.length} échéance{late.length > 1 ? "s" : ""} en retard</b> · {money(late.reduce((s, c) => s + c.amount, 0))}
            <span className="block text-label">{late.map((c) => c.name).join(", ")}</span>
          </p>
        </div>
      )}

      <Card>
        <SectionHeader title="Échéances" subtitle="« Marquer payée » enregistre l’opération réelle. Montant : ligne du budget de même catégorie." />
        {charges.length === 0 ? (
          <EmptyState title="Aucune récurrence active pour ce mois" action={<Link href="/charges/new">Ajouter une récurrence</Link>} />
        ) : (
          <ul className="due-list">
            {charges.map((c) => {
              const t = c.payment?.transaction;
              const [tone, label] = STATUS[c.status];
              return (
                <li key={c.id} className={c.status === "late" ? "is-late" : undefined}>
                  <div className="due-row">
                    <DateTile date={c.due} />
                    <span className="min-w-0 flex-1">
                      <Link href={`/charges/${c.id}`} className="block truncate font-bold text-heading no-underline hover:underline">{c.name}</Link>
                      <small className="block truncate text-label text-faint">
                        {c.category.parent ? `${c.category.parent.name} › ` : ""}{c.category.name}
                        {c.loanId && " · crédit"}
                      </small>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      {c.budgeted ? <b className="ab-num text-heading">{money(c.amount)}</b> : <small className="text-label text-faint">Absente du budget</small>}
                      <Badge dot tone={tone}>{label}</Badge>
                    </span>
                  </div>
                  {t ? (
                    <p className="due-meta">
                      Payée {money(t.amount)} le {frDay(t.occurredOn)} · <Link href={`/operations/${t.id}`}>voir l’opération</Link>
                    </p>
                  ) : (
                    <div className="due-meta"><PayCharge id={c.id} month={month} amount={c.amount} due={c.due} late={c.status === "late"} /></div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {inactive.length > 0 && (
        <details>
          <summary>Récurrences désactivées ({inactive.length})</summary>
          <ul className="list">
            {inactive.map((c) => (
              <li key={c.id}>
                <Link href={`/charges/${c.id}`}><span>{c.name}<small className="muted">Le {c.dueDay}</small></span><Icon name="chevron" className="size-4" /></Link>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
