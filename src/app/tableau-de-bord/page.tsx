import Link from "next/link";
import { getScope } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import type { ChargeStatus } from "@/lib/calendar";
import { listCategories } from "@/lib/categories";
import { addMonths, formatMonth, parseMonth } from "@/lib/budget";
import { getDashboard, getDashboardCharts } from "@/lib/dashboard";
import { formatDay, parseDay, payers, todayIn } from "@/lib/ledger";
import { configuredProviders } from "@/lib/llm";
import { formatCents } from "@/lib/money";
import { getSplit } from "@/lib/split";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Stat } from "@/components/ui/stat";
import { analyzeAction } from "../actions";
import { ActionForm } from "../form";
import { EntryForm } from "../operations/entry-form";
import { AnalyticsBento } from "./charts";

const monthLabel = (month: Date) => new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(month);
const frDay = (d: Date) => formatDay(d).split("-").reverse().join("/");
const STATUS: Record<ChargeStatus, [string, string]> = { paid: ["pos", "Payée"], late: ["neg", "En retard"], due: ["muted", "À payer"] };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const user = await requireUser();
  const todayStr = todayIn(user.household.timezone);
  const scope = await getScope(user);
  const today = parseDay(todayStr)!;
  const month = parseMonth((await searchParams).m) ?? parseMonth(todayStr.slice(0, 7))!;
  // Graphiques arrêtés au dernier jour du mois affiché, jamais au-delà d'aujourd'hui, ni avant le 1er du mois affiché (mois futur).
  const asOf = new Date(Math.max(month.getTime(), Math.min(today.getTime(), addMonths(month, 1).getTime() - 86_400_000)));
  const [d, categories, members] = await Promise.all([getDashboard(scope, today, month), listCategories(user.householdId), payers(user.householdId)]);
  const money = (cents: number) => formatCents(cents, user.household.currency);
  const [charts, split] = await Promise.all([
    // Graphiques seulement s'il existe des opérations réelles : jamais de courbe inventée.
    d.recent.length ? getDashboardCharts(scope, asOf) : null,
    // Partage : utile à partir de deux membres.
    d.budget ? getSplit(user.householdId, d.month).then((s) => (s.members.length > 1 ? s : null)) : null,
  ]);

  return (
    <>
      <nav className="pager" aria-label="Mois">
        <Link href={`/tableau-de-bord?m=${formatMonth(addMonths(month, -1))}`}>← Mois précédent</Link>
        <h1>Tableau de bord · {monthLabel(d.month)}</h1>
        <Link href={`/tableau-de-bord?m=${formatMonth(addMonths(month, 1))}`}>Mois suivant →</Link>
      </nav>
      {formatMonth(month) !== todayStr.slice(0, 7) && <p className="mb-4 text-center"><Link href="/tableau-de-bord">Revenir au mois en cours</Link></p>}
      {configuredProviders().length > 0 && (
        <ActionForm action={analyzeAction} className="form mb-4">
          <button type="submit">Analyser</button>
        </ActionForm>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Revenus du mois" value={money(d.income)} note={d.budget ? "Saisis dans le budget du mois" : "Aucun budget ce mois-ci"} />
        <Stat label="Dépenses du mois" value={money(d.expense)} note="Opérations enregistrées" />
        <Stat label="Résultat du mois" value={money(d.result)} tone={d.result < 0 ? "neg" : undefined} note="Revenus prévus − dépenses" />
        <Stat label="Reste réel" value={money(d.net)} tone={d.net < 0 ? "neg" : undefined} note="Recettes − dépenses enregistrées" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-12">
          <CardHeader>
            <CardTitle>Dernières opérations</CardTitle>
            <Link href="/operations" className="text-sm">Tout voir</Link>
          </CardHeader>
          {d.recent.length === 0 ? (
            <EmptyState title="Aucune opération enregistrée">Les dépenses et revenus saisis apparaîtront ici.</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm tabular-nums">
                <thead>
                  <tr className="text-left text-muted">
                    <th className="py-2 pr-3 font-medium">Date</th>
                    <th className="py-2 pr-3 font-medium">Libellé</th>
                    <th className="hidden py-2 pr-3 font-medium sm:table-cell">Payé par</th>
                    <th className="hidden py-2 pr-3 font-medium md:table-cell">Catégorie</th>
                    <th className="py-2 text-right font-medium">Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {d.recent.map((t) => {
                    const credit = t.kind === "INCOME";
                    const fallback = credit ? "Revenu" : "Dépense";
                    return (
                      <tr key={t.id} className="border-t border-hairline">
                        <td className="py-2 pr-3 whitespace-nowrap text-muted">{frDay(t.occurredOn)}</td>
                        <td className="py-2 pr-3 break-words">{t.note || fallback}</td>
                        <td className="hidden py-2 pr-3 sm:table-cell">{t.paidBy.name}</td>
                        <td className="hidden py-2 pr-3 text-muted md:table-cell">
                          {t.category ? `${t.category.parent ? `${t.category.parent.name} › ` : ""}${t.category.name}` : "Sans catégorie"}
                        </td>
                        <td className={`py-2 text-right whitespace-nowrap ${credit ? "text-pos" : "text-heading"}`}>
                          {money(credit ? t.amount : -t.amount)}
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
                    <span className="min-w-0">{c.name}<small className={`block text-xs ${STATUS[c.status][0]}`}>{STATUS[c.status][1]} · {frDay(c.due)}{!c.budgeted && " · absente du budget"}</small></span>
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
              <dt>Épargne prévue</dt><dd>{money(d.budget.totals.savings)}</dd>
              <dt>Reste prévisionnel</dt><dd className={d.budget.totals.remaining < 0 ? "neg" : undefined}>{money(d.budget.totals.remaining)}</dd>
              <dt>Reste réel</dt><dd className={d.net < 0 ? "neg" : undefined}>{money(d.net)}</dd>
            </dl>
          ) : (
            <EmptyState title="Pas encore de budget ce mois-ci" action={<ButtonLink href="/budget" size="sm" variant="secondary">Préparer le budget</ButtonLink>} />
          )}
        </Card>

        {split && (
          <Card className="lg:col-span-12">
            <CardHeader>
              <CardTitle>Reste à verser</CardTitle>
              <Link href="/budget" className="text-sm">Partage du budget</Link>
            </CardHeader>
            <ul className="m-0 grid list-none gap-x-8 p-0 sm:grid-cols-2">
              {split.members.map((m) => (
                <li key={m.userId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-hairline py-2.5">
                  <span className="min-w-0">{m.name}<small className="block text-xs text-muted">Dû {money(m.due)} · communes payées {money(m.contribution)}</small></span>
                  <span className="amount">{m.toTransfer < 0 ? <>à recevoir {money(-m.toTransfer)}</> : money(m.toTransfer)}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      {charts && <div className="mt-4"><AnalyticsBento currency={user.household.currency} data={charts} /></div>}

      <details>
        <summary>Saisie rapide d’une opération</summary>
        {/* Clé = dernière opération : une saisie réussie change la clé, le formulaire repart vide. */}
        <EntryForm key={d.recent[0]?.id} back="dashboard" members={members} categories={categories} v={{ occurredOn: todayStr, paidById: user.id }} />
      </details>
    </>
  );
}
