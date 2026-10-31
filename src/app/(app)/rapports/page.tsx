import Link from "next/link";
import type { ReportKind, ReportTrigger } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { getBudget } from "@/lib/budget";
import { configuredProviders, PROVIDER_LABELS } from "@/lib/llm";
import { formatCents } from "@/lib/money";
import { formatDay } from "@/lib/ledger";
import { listReports, type DailyInput, type DailyOutput, type MonthlyInput, type MonthlyOutput, type Pace, type PlanInput, type PlanOutput } from "@/lib/report";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Stat } from "@/components/ui/stat";
import { analyzeAction, applyPlanAction } from "@/app/actions";
import { ActionForm, Field } from "@/app/form";

const TRIGGERS: Record<ReportTrigger, string> = { MANUAL: "À la demande", AUTO: "Automatique" };
const KINDS: Record<ReportKind, string> = { DAILY: "Rapport du jour", MONTHLY: "Bilan du mois", PLAN: "Préparation du budget" };
const PACE: Record<Pace, { label: string; tone: "success" | "warning" | "danger" }> = {
  ok: { label: "Dans le rythme", tone: "success" },
  rapide: { label: "Trop rapide", tone: "warning" },
  dépassé: { label: "Dépassé", tone: "danger" },
};
const GROUPS = { income: "Revenus", fixed: "Charges fixes", savings: "Épargne", variable: "Charges variables" } as const;
const frDay = (s: string) => s.split("-").reverse().join("/");
const monthLabel = (s: string) => new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${s}-01`));
const TH = "py-2 pr-3 font-medium";
const TD = "py-2 pr-3";
const R = "text-right whitespace-nowrap";

type Money = (cents: number) => string;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ id?: string; lignes?: string }> }) {
  const user = await requireUser();
  const { id, lignes } = await searchParams;
  const providers = configuredProviders(user.household);
  const reports = await listReports(user);
  const report = id ? reports.find((r) => r.id === id) : reports[0];
  const money: Money = (cents) => formatCents(cents, user.household.currency);
  const when = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: user.household.timezone });

  return (
    <>
      <h1>Rapports</h1>
      {lignes && <p role="status" className="text-pos">Répartition appliquée : {lignes} ligne(s) du budget mise(s) à jour.</p>}

      {providers.length > 0 && (
        <ActionForm action={analyzeAction} className="form mb-4" pendingNotice="L'IA analyse votre budget… cela peut prendre quelques minutes avec un modèle local.">
          {providers.length > 1 && (
            <Field name="provider" label="Fournisseur">
              <select name="provider" defaultValue="">
                <option value="">Réglage du foyer</option>
                {providers.map((p) => <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>)}
              </select>
            </Field>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="submit" name="kind" value="DAILY">Rapport du jour</button>
            <button type="submit" name="kind" value="MONTHLY" className="secondary">Bilan du mois dernier</button>
          </div>
          <p className="m-0 text-sm text-muted">La répartition des charges variables se prépare depuis la page Budget, après saisie des revenus, charges fixes et épargne.</p>
        </ActionForm>
      )}

      {id && !report && <p className="error" role="alert">Rapport introuvable.</p>}
      {!report && !id && <EmptyState title="Aucun rapport">Les rapports générés apparaîtront ici.</EmptyState>}
      {report && (
        <div className="grid gap-4">
          <p className="m-0 text-sm text-muted">
            {KINDS[report.kind]} · {frDay(formatDay(report.day))} · {TRIGGERS[report.trigger]} · {PROVIDER_LABELS[report.provider]}{report.model && ` (${report.model})`}
          </p>
          {report.error && <p className="error" role="alert">Le rapport a échoué : {report.error}</p>}
          {report.output && report.kind === "DAILY" && <Daily input={report.input as DailyInput} output={report.output as DailyOutput} money={money} />}
          {report.output && report.kind === "MONTHLY" && <Monthly input={report.input as MonthlyInput} output={report.output as MonthlyOutput} money={money} />}
          {report.output && report.kind === "PLAN" && (
            <Plan reportId={report.id} householdId={user.householdId} budgetId={report.budgetId} input={report.input as PlanInput} output={report.output as PlanOutput} money={money} />
          )}
        </div>
      )}

      {reports.length > 0 && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Historique</CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm tabular-nums">
              <thead>
                <tr className="text-left text-muted">
                  <th className={TH}>Date</th>
                  <th className={TH}>Type</th>
                  <th className={TH}>Déclencheur</th>
                  <th className="py-2 font-medium">Statut</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id} className="border-t border-hairline">
                    <td className={TD}>
                      <Link href={`/rapports?id=${r.id}`} aria-current={r.id === report?.id ? "page" : undefined}>{when.format(r.createdAt)}</Link>
                    </td>
                    <td className={TD}>{KINDS[r.kind]}</td>
                    <td className={TD}>{TRIGGERS[r.trigger]}</td>
                    <td className="py-2">{r.error ? <Badge tone="danger">Erreur</Badge> : <Badge tone="success">Prêt</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

/** Liste de phrases du LLM ; rien si vide. */
function Points({ title, items, tone }: { title: string; items: string[]; tone?: "neg" | "pos" }) {
  if (!items.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className={tone === "neg" ? "text-neg" : tone === "pos" ? "text-pos" : undefined}>{title}</CardTitle>
      </CardHeader>
      <ul className="m-0 grid gap-2 pl-5">
        {items.map((t, i) => <li key={i}>{t}</li>)}
      </ul>
    </Card>
  );
}

/** Rapport du jour : chiffres de l'app au moment du rapport, textes du LLM. */
function Daily({ input, output, money }: { input: DailyInput; output: DailyOutput; money: Money }) {
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Où en est le mois · jour {input.day} sur {input.daysInMonth}</CardTitle>
        </CardHeader>
        <p className="m-0">{output.summary}</p>
      </Card>
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Charges variables" value={money(input.actual.variable)} note={`Prévu ${money(input.planned.variable)}`} />
        <Stat label="Reste réel" value={money(input.actual.remaining)} tone={input.actual.remaining < 0 ? "neg" : undefined} note={`Prévu ${money(input.planned.remaining)}`} />
        <Stat label="Sans catégorie" value={money(input.uncategorized.amount)} note={`${input.uncategorized.count} dépense(s)`} />
      </div>
      <Points title="Alertes" items={output.alerts} tone="neg" />
      <Points title="Conseils" items={output.advice} />

      <Card>
        <CardHeader>
          <CardTitle>Enveloppes</CardTitle>
          <CardDescription>Attendu = prévu au prorata des jours écoulés ; projection = fin de mois au rythme actuel.</CardDescription>
        </CardHeader>
        {input.lines.length === 0 ? (
          <p className="m-0 text-sm text-muted">Aucune ligne de charge variable.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm tabular-nums">
              <thead>
                <tr className="text-left text-muted">
                  <th className={TH}>Ligne</th>
                  <th className={`${TH} text-right`}>Prévu</th>
                  <th className={`${TH} text-right`}>Dépensé</th>
                  <th className={`${TH} text-right`}>Attendu</th>
                  <th className={`${TH} text-right`}>Projection</th>
                  <th className={`${TH} text-right`}>Par jour restant</th>
                  <th className="py-2 font-medium">Rythme</th>
                </tr>
              </thead>
              <tbody>
                {input.lines.map((l, i) => (
                  <tr key={i} className="border-t border-hairline">
                    <td className={`${TD} break-words`}>{l.label}</td>
                    <td className={`${TD} ${R}`}>{money(l.planned)}</td>
                    <td className={`${TD} ${R}`}>{money(l.actual)}</td>
                    <td className={`${TD} ${R}`}>{money(l.expected)}</td>
                    <td className={`${TD} ${R} ${l.projected > l.planned ? "text-neg" : ""}`}>{money(l.projected)}</td>
                    <td className={`${TD} ${R}`}>{money(l.perDay)}</td>
                    <td className="py-2"><Badge tone={PACE[l.status].tone}>{PACE[l.status].label}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {input.todayOps.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Opérations du jour</CardTitle>
          </CardHeader>
          <ul className="m-0 grid list-none gap-1 p-0 text-sm tabular-nums">
            {input.todayOps.map((t, i) => (
              <li key={i} className="flex justify-between gap-3 border-t border-hairline py-1">
                <span className="break-words">{t.label || "—"} <small className="text-muted">· {t.category ?? "Sans catégorie"} · {t.paidBy}</small></span>
                <span className={t.kind === "EXPENSE" ? "text-heading" : "text-pos"}>{money(t.kind === "EXPENSE" ? -t.amount : t.amount)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

/** Bilan du mois : prévu le 1er contre réel. */
function Monthly({ input, output, money }: { input: MonthlyInput; output: MonthlyOutput; money: Money }) {
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Bilan de {monthLabel(input.month)}</CardTitle>
        </CardHeader>
        <p className="m-0">{output.verdict}</p>
      </Card>
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Reste réel" value={money(input.actual.remaining)} tone={input.actual.remaining < input.planned.remaining ? "neg" : "pos"} note={`Prévu ${money(input.planned.remaining)}`} />
        <Stat label="Épargne réalisée" value={money(input.actual.savings)} tone={input.actual.savings < input.planned.savings ? "neg" : "pos"} note={`Prévu ${money(input.planned.savings)}`} />
        <Stat label="Hors budget" value={money(input.offBudget)} note="Dépenses sans ligne au budget" />
      </div>
      <Points title="Erreurs à éviter" items={output.mistakes} tone="neg" />
      <Points title="Conseils pour le mois prochain" items={output.advice} />
      <Points title="Points tenus" items={output.respected} tone="pos" />

      <Card>
        <CardHeader>
          <CardTitle>Prévu contre réel</CardTitle>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm tabular-nums">
            <thead>
              <tr className="text-left text-muted">
                <th className={TH}>Ligne</th>
                <th className={TH}>Type</th>
                <th className={`${TH} text-right`}>Prévu</th>
                <th className={`${TH} text-right`}>Réel</th>
                <th className="py-2 text-right font-medium">Écart</th>
              </tr>
            </thead>
            <tbody>
              {input.lines.map((l, i) => {
                // Écart défavorable : dépense au-dessus du prévu, revenu en dessous.
                const bad = l.group === "income" ? l.diff < 0 : l.diff > 0;
                return (
                  <tr key={i} className="border-t border-hairline">
                    <td className={`${TD} break-words`}>{l.label}</td>
                    <td className={`${TD} text-muted`}>{GROUPS[l.group]}</td>
                    <td className={`${TD} ${R}`}>{money(l.planned)}</td>
                    <td className={`${TD} ${R}`}>{money(l.actual)}</td>
                    <td className={`py-2 ${R} ${l.diff && bad ? "text-neg" : l.diff ? "text-pos" : ""}`}>{l.diff > 0 ? "+" : ""}{money(l.diff)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

/** Préparation du budget : répartition proposée du reste sur les charges variables, applicable au budget (brouillon). */
async function Plan({ reportId, householdId, budgetId, input, output, money }: {
  reportId: string; householdId: string; budgetId: string; input: PlanInput; output: PlanOutput; money: Money;
}) {
  const budget = await getBudget(householdId, new Date(`${input.month}-01T00:00:00Z`));
  const locked = budget?.id !== budgetId ? "Budget introuvable." : budget.status === "VALIDATED" ? "Repasser le budget en brouillon pour appliquer." : null;
  const proposed = new Map(output.lines.map((l) => [l.budgetItemId, l]));
  const avg = (h: number[]) => Math.round(h.reduce((s, x) => s + x, 0) / h.length);
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Revenus" value={money(input.income)} />
        <Stat label="Charges fixes" value={money(input.fixed)} />
        <Stat label="Épargne voulue" value={money(input.savings)} />
        <Stat label="À répartir" value={money(input.toDistribute)} tone="pos" note="Revenus − fixes − épargne" />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Répartition proposée · {monthLabel(input.month)}</CardTitle>
          <CardDescription>Moyenne des 3 derniers mois de dépenses réelles en repère.</CardDescription>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm tabular-nums">
            <thead>
              <tr className="text-left text-muted">
                <th className={TH}>Ligne</th>
                <th className={`${TH} text-right`}>Moy. 3 mois</th>
                <th className={`${TH} text-right`}>Prévu actuel</th>
                <th className={`${TH} text-right`}>Proposé</th>
                <th className="py-2 font-medium">Pourquoi</th>
              </tr>
            </thead>
            <tbody>
              {input.lines.map((l) => (
                <tr key={l.id} className="border-t border-hairline">
                  <td className={`${TD} break-words`}>{l.label}</td>
                  <td className={`${TD} ${R} text-muted`}>{money(avg(l.history))}</td>
                  <td className={`${TD} ${R} text-muted`}>{money(l.planned)}</td>
                  <td className={`${TD} ${R} font-medium text-heading`}>{money(proposed.get(l.id)?.amount ?? 0)}</td>
                  <td className="py-2 text-muted">{proposed.get(l.id)?.reason}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-hairline font-medium">
                <td className={TD}>Total</td>
                <td className={`${TD} ${R}`}>{money(input.lines.reduce((s, l) => s + avg(l.history), 0))}</td>
                <td className={`${TD} ${R}`}>{money(input.lines.reduce((s, l) => s + l.planned, 0))}</td>
                <td className={`${TD} ${R}`}>{money(output.lines.reduce((s, l) => s + l.amount, 0))}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        <ActionForm action={applyPlanAction}>
          <input type="hidden" name="reportId" value={reportId} />
          <button type="submit" disabled={!!locked} aria-describedby={locked ? "plan-locked" : undefined}>Appliquer au budget</button>
          {locked && <p id="plan-locked" className="m-0 text-sm text-muted">{locked}</p>}
        </ActionForm>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Conseil</CardTitle>
        </CardHeader>
        <p className="m-0">{output.advice}</p>
      </Card>
    </>
  );
}
