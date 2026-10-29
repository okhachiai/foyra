import Link from "next/link";
import { getScope } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import type { ChargeStatus } from "@/lib/calendar";
import { listCategories } from "@/lib/categories";
import { getDashboard, getDashboardCharts } from "@/lib/dashboard";
import { formatDay, parseDay, todayIn, writableAccounts } from "@/lib/ledger";
import { formatCents } from "@/lib/money";
import { getVisibleSplit } from "@/lib/split";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Stat } from "@/components/ui/stat";
import { KIND_LABELS } from "../accounts/kinds";
import { EntryForm } from "../accounts/[id]/tx-forms";
import { AnalyticsBento } from "./charts";

const monthLabel = (month: Date) => new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(month);
const frDay = (d: Date) => formatDay(d).split("-").reverse().join("/");
const STATUS: Record<ChargeStatus, [string, string]> = { paid: ["pos", "Payée"], late: ["neg", "En retard"], due: ["muted", "À payer"] };

export default async function DashboardPage() {
  const user = await requireUser();
  const todayStr = todayIn(user.household.timezone);
  const scope = await getScope(user);
  const today = parseDay(todayStr)!;
  const [d, categories, writable] = await Promise.all([getDashboard(scope, today), listCategories(user.householdId), writableAccounts(scope)]);
  const money = (cents: number) => formatCents(cents, user.household.currency);
  const [charts, split] = await Promise.all([
    // Graphiques seulement s'il existe des opérations réelles : jamais de courbe inventée.
    d.recent.length ? getDashboardCharts(scope, today, d.total) : null,
    d.budget ? getVisibleSplit(user, scope, d.month) : null,
  ]);

  return (
    <>
      <h1>Tableau de bord · {monthLabel(d.month)}</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Revenus du mois" value={money(d.income)} note="Opérations enregistrées, hors virements" />
        <Stat label="Dépenses du mois" value={money(d.expense)} note="Opérations enregistrées, hors virements" />
        <Stat label="Résultat du mois" value={money(d.result)} tone={d.result < 0 ? "neg" : undefined} note="Revenus − dépenses" />
        <Stat label="Total des soldes" value={money(d.total)} tone={d.total < 0 ? "neg" : undefined} note={`${d.accounts.length} compte${d.accounts.length > 1 ? "s" : ""} actif${d.accounts.length > 1 ? "s" : ""} accessible${d.accounts.length > 1 ? "s" : ""}`} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-5">
          <CardHeader>
            <CardTitle>Comptes</CardTitle>
            <Link href="/accounts" className="text-sm">Tout voir</Link>
          </CardHeader>
          {d.accounts.length === 0 ? (
            <EmptyState title="Aucun compte accessible" action={<ButtonLink href="/accounts/new" size="sm">Créer mon premier compte</ButtonLink>}>
              Créez un compte (courant, épargne, espèces…) avec son solde initial pour commencer.
            </EmptyState>
          ) : (
            <ul className="m-0 flex list-none flex-col p-0">
              {d.accounts.map((a) => (
                <li key={a.id} className="border-t border-hairline first:border-t-0">
                  <Link href={`/accounts/${a.id}`} className="flex items-center justify-between gap-4 py-2.5 text-inherit no-underline hover:text-heading">
                    <span className="min-w-0">{a.name}<small className="block text-xs text-muted">{KIND_LABELS[a.kind]}</small></span>
                    <span className={a.balance < 0 ? "amount neg" : "amount"}>{money(a.balance)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="lg:col-span-7">
          <CardHeader>
            <CardTitle>Dernières opérations</CardTitle>
          </CardHeader>
          {d.recent.length === 0 ? (
            <EmptyState title="Aucune opération enregistrée">Les dépenses, revenus et virements saisis apparaîtront ici.</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm tabular-nums">
                <thead>
                  <tr className="text-left text-muted">
                    <th className="py-2 pr-3 font-medium">Date</th>
                    <th className="py-2 pr-3 font-medium">Libellé</th>
                    <th className="hidden py-2 pr-3 font-medium sm:table-cell">Compte</th>
                    <th className="hidden py-2 pr-3 font-medium md:table-cell">Catégorie</th>
                    <th className="py-2 text-right font-medium">Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {d.recent.map((t) => {
                    const transfer = t.kind === "TRANSFER";
                    const credit = t.kind === "INCOME" || t.transferSide === "IN";
                    const fallback = transfer ? "Virement" : t.kind === "INCOME" ? "Revenu" : "Dépense";
                    return (
                      <tr key={t.id} className="border-t border-hairline">
                        <td className="py-2 pr-3 whitespace-nowrap text-muted">{frDay(t.occurredOn)}</td>
                        <td className="py-2 pr-3 break-words">{t.note || fallback}</td>
                        <td className="hidden py-2 pr-3 sm:table-cell">{t.account.name}</td>
                        <td className="hidden py-2 pr-3 text-muted md:table-cell">
                          {transfer ? "Virement" : t.category ? `${t.category.parent ? `${t.category.parent.name} › ` : ""}${t.category.name}` : "Sans catégorie"}
                        </td>
                        <td className={`py-2 text-right whitespace-nowrap ${credit ? "text-pos" : "text-heading"}`}>
                          {transfer ? money(t.amount) : money(credit ? t.amount : -t.amount)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="lg:col-span-7">
          <CardHeader>
            <CardTitle>Dépenses récurrentes à payer</CardTitle>
            <span className="amount">{money(d.toPay)}</span>
          </CardHeader>
          {d.late.count > 0 && <p className="m-0 text-sm text-neg">{d.late.count} en retard · {money(d.late.amount)}</p>}
          {d.unpaid.length === 0 ? (
            <p className="m-0 text-sm text-muted">Aucune échéance de dépense à payer ce mois-ci.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col p-0">
              {d.unpaid.map((c) => (
                <li key={c.id} className="border-t border-hairline first:border-t-0">
                  <Link href="/calendrier" className="flex items-center justify-between gap-4 py-2.5 text-inherit no-underline hover:text-heading">
                    <span className="min-w-0">{c.name}<small className={`block text-xs ${STATUS[c.status][0]}`}>{STATUS[c.status][1]} · {frDay(c.due)} · {c.account.name}</small></span>
                    <span className="amount">{money(c.amount)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="lg:col-span-5">
          <CardHeader>
            <CardTitle>Budget prévisionnel</CardTitle>
            {d.budget && <Badge tone={d.budget.status === "VALIDATED" ? "success" : "muted"}>{d.budget.status === "VALIDATED" ? "Validé" : "Brouillon"}</Badge>}
          </CardHeader>
          {d.budget ? (
            <dl className="totals">
              <dt>Revenus prévus</dt><dd>{money(d.budget.totals.income)}</dd>
              <dt>Charges fixes prévues</dt><dd>{money(d.budget.totals.fixed)}</dd>
              <dt>Charges variables prévues</dt><dd>{money(d.budget.totals.variable)}</dd>
              <dt>Reste prévisionnel</dt><dd className={d.budget.totals.remaining < 0 ? "neg" : undefined}>{money(d.budget.totals.remaining)}</dd>
            </dl>
          ) : (
            <EmptyState title="Pas encore de budget ce mois-ci" action={<ButtonLink href="/budget" size="sm" variant="secondary">Préparer le budget</ButtonLink>} />
          )}
        </Card>

        {split && (
          <Card className="lg:col-span-12">
            <CardHeader>
              <CardTitle>Reste à virer</CardTitle>
              <Link href="/budget" className="text-sm">Partage du budget</Link>
            </CardHeader>
            <ul className="m-0 grid list-none gap-x-8 p-0 sm:grid-cols-2">
              {split.members.map((m) => (
                <li key={m.userId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-hairline py-2.5">
                  <span className="min-w-0">{m.name}<small className="block text-xs text-muted">Dû {money(m.due)} · déjà contribué {money(m.contribution)}</small></span>
                  <span className="flex items-center gap-3">
                    <span className="amount">{m.toTransfer < 0 ? <>à recevoir {money(-m.toTransfer)}</> : money(m.toTransfer)}</span>
                    {split.transfer[m.userId] && <ButtonLink href={split.transfer[m.userId]} size="sm" variant="secondary">Préparer le virement</ButtonLink>}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      {charts && <div className="mt-4"><AnalyticsBento currency={user.household.currency} total={d.total} data={charts} /></div>}

      {writable.length > 0 && (
        <details>
          <summary>Saisie rapide d’une opération</summary>
          {/* Clé = nombre d'opérations récentes + solde : une saisie réussie change la clé, le formulaire repart vide. */}
          <EntryForm key={`${d.total}:${d.recent[0]?.id}`} accounts={writable} categories={categories} v={{ occurredOn: todayStr }} />
        </details>
      )}
    </>
  );
}
