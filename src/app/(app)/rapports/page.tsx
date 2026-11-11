import Link from "next/link";
import type { ReportKind, ReportTrigger } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { getBudget } from "@/lib/budget";
import { configuredProviders, PROVIDER_LABELS } from "@/lib/llm";
import { formatCents } from "@/lib/money";
import { formatDay, monthLabel } from "@/lib/ledger";
import { listReports, type DailyInput, type DailyOutput, type MonthlyInput, type MonthlyOutput, type Pace, type PlanInput, type PlanOutput } from "@/lib/report";
import { Badge } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon, type IconName } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
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
      <PageHeader eyebrow="Foyra / Rapports IA" title="Rapports IA" subtitle="Analyses de votre budget : chiffres calculés par Foyra, commentaires rédigés par l’IA." />
      {lignes && <p role="status" className="alert success mb-4"><Icon name="shield" className="size-5 shrink-0" />Répartition appliquée : {lignes} ligne(s) du budget mise(s) à jour.</p>}

      <div className="grid items-start gap-4 lg:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-8">
          {id && !report && <p className="alert danger" role="alert"><Icon name="alert" className="size-5 shrink-0" />Rapport introuvable.</p>}
          {!report && !id && <EmptyState title="Aucun rapport">Les rapports générés apparaîtront ici.</EmptyState>}
          {report && (
            <>
              <Card>
                <SectionHeader
                  title={KINDS[report.kind]}
                  subtitle={<>{frDay(formatDay(report.day))} · {TRIGGERS[report.trigger]} · {PROVIDER_LABELS[report.provider]}{report.model && ` (${report.model})`}</>}
                  action={report.error ? <Badge dot tone="danger">Erreur</Badge> : <Badge dot tone="success">Prêt</Badge>}
                />
                {report.error && <p className="alert danger" role="alert"><Icon name="alert" className="size-5 shrink-0" />Le rapport a échoué : {report.error}</p>}
              </Card>
              {report.output && report.kind === "DAILY" && <Daily input={report.input as DailyInput} output={report.output as DailyOutput} money={money} />}
              {report.output && report.kind === "MONTHLY" && <Monthly input={report.input as MonthlyInput} output={report.output as MonthlyOutput} money={money} />}
              {report.output && report.kind === "PLAN" && (
                <Plan reportId={report.id} householdId={user.householdId} budgetId={report.budgetId} input={report.input as PlanInput} output={report.output as PlanOutput} money={money} />
              )}
            </>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-4 lg:col-span-4">
          <Card>
            <SectionHeader title="Nouveau rapport" subtitle="La répartition des charges variables se prépare depuis la page Budget." />
            {providers.length > 0 ? (
              <ActionForm action={analyzeAction} className="form" pendingNotice="L'IA analyse votre budget… cela peut prendre quelques minutes avec un modèle local.">
                {providers.length > 1 && (
                  <Field name="provider" label="Fournisseur">
                    <select name="provider" defaultValue="">
                      <option value="">Réglage du foyer</option>
                      {providers.map((p) => <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>)}
                    </select>
                  </Field>
                )}
                <div className="flex flex-wrap gap-2">
                  <button type="submit" name="kind" value="DAILY"><Icon name="reports" className="size-4" />Rapport du jour</button>
                  <button type="submit" name="kind" value="MONTHLY" className="secondary">Bilan du mois dernier</button>
                </div>
              </ActionForm>
            ) : (
              <EmptyState title="Aucun fournisseur IA configuré" action={<Link href="/parametres">Ouvrir les paramètres</Link>}>Choisir un fournisseur dans Paramètres pour générer des rapports.</EmptyState>
            )}
          </Card>

          {reports.length > 0 && (
            <Card>
              <SectionHeader title="Historique" subtitle={`${reports.length} rapport${reports.length > 1 ? "s" : ""}`} />
              <ul className="due-list">
                {reports.map((r) => (
                  <li key={r.id}>
                    <Link href={`/rapports?id=${r.id}`} aria-current={r.id === report?.id ? "page" : undefined}>
                      <span className={`row-icon ${r.error ? "expense" : ""}`}><Icon name={r.error ? "alert" : "reports"} className="size-4" /></span>
                      <span className="min-w-0 flex-1">
                        <b className="block truncate text-heading">{KINDS[r.kind]}</b>
                        <small className="block truncate text-label text-faint">{when.format(r.createdAt)} · {TRIGGERS[r.trigger]}</small>
                      </span>
                      {r.error ? <Badge dot tone="danger">Erreur</Badge> : <Badge dot tone="success">Prêt</Badge>}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

const POINTS = {
  alert: { icon: "alert", cls: "expense" },
  advice: { icon: "target", cls: "" },
  done: { icon: "shield", cls: "" },
} satisfies Record<string, { icon: IconName; cls: string }>;

/** Liste de phrases du LLM (alertes, recommandations, points tenus) ; rien si vide. */
function Points({ title, items, kind }: { title: string; items: string[]; kind: keyof typeof POINTS }) {
  if (!items.length) return null;
  return (
    <Card className={kind === "alert" ? "card-alert" : undefined}>
      <div className="kpi-top">
        <span className={`kpi-icon ${POINTS[kind].cls}`}><Icon name={POINTS[kind].icon} className="size-4" /></span>
        <h2 className="m-0 text-section font-bold text-heading">{title}</h2>
        <Badge tone={kind === "alert" ? "danger" : "muted"} className="ml-auto">{items.length}</Badge>
      </div>
      <ul className="points">
        {items.map((t, i) => <li key={i}>{t}</li>)}
      </ul>
    </Card>
  );
}

/** Résumé rédigé par le LLM. */
function Summary({ title, text }: { title: string; text: string }) {
  return (
    <Card>
      <p className="eyebrow">Résumé</p>
      <h2 className="m-0 text-section font-bold text-heading">{title}</h2>
      <p className="m-0 text-body leading-relaxed">{text}</p>
    </Card>
  );
}

/** Rapport du jour : chiffres de l'app au moment du rapport, textes du LLM. */
function Daily({ input, output, money }: { input: DailyInput; output: DailyOutput; money: Money }) {
  return (
    <>
      <Summary title={`Où en est le mois · jour ${input.day} sur ${input.daysInMonth}`} text={output.summary} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Charges variables" value={money(input.actual.variable)} note={`Prévu ${money(input.planned.variable)}`} />
        <Stat label="Reste réel" value={money(input.actual.remaining)} tone={input.actual.remaining < 0 ? "neg" : undefined} note={`Prévu ${money(input.planned.remaining)}`} />
        <Stat label="Sans catégorie" value={money(input.uncategorized.amount)} note={`${input.uncategorized.count} dépense(s)`} />
      </div>
      <Points title="Alertes" items={output.alerts} kind="alert" />
      <Points title="Recommandations" items={output.advice} kind="advice" />

      <Card variant="table">
        <SectionHeader title="Enveloppes" subtitle="Attendu = prévu au prorata des jours écoulés ; projection = fin de mois au rythme actuel." />
        {input.lines.length === 0 ? (
          <p className="m-0 text-label text-muted">Aucune ligne de charge variable.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Ligne</th>
                  <th className="num hidden sm:table-cell">Prévu</th>
                  <th className="num">Dépensé</th>
                  <th className="num hidden md:table-cell">Attendu</th>
                  <th className="num hidden sm:table-cell">Projection</th>
                  <th className="num hidden lg:table-cell">Par jour restant</th>
                  <th>Rythme</th>
                </tr>
              </thead>
              <tbody>
                {input.lines.map((l, i) => (
                  <tr key={i}>
                    <td className="break-words">{l.label}<small className="block text-label font-medium text-faint sm:hidden">Prévu {money(l.planned)} · projection {money(l.projected)}</small></td>
                    <td className="num hidden sm:table-cell">{money(l.planned)}</td>
                    <td className="num">{money(l.actual)}</td>
                    <td className="num hidden md:table-cell">{money(l.expected)}</td>
                    <td className={`num hidden sm:table-cell ${l.projected > l.planned ? "text-neg" : ""}`}>{money(l.projected)}</td>
                    <td className="num hidden lg:table-cell">{money(l.perDay)}</td>
                    <td><Badge dot tone={PACE[l.status].tone}>{PACE[l.status].label}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {input.todayOps.length > 0 && (
        <Card>
          <SectionHeader title="Opérations du jour" />
          <ul className="due-list">
            {input.todayOps.map((t, i) => (
              <li key={i}>
                <div className="due-row">
                  <span className={`row-icon ${t.kind === "EXPENSE" ? "expense" : ""}`}><Icon name={t.kind === "EXPENSE" ? "arrowOut" : "arrowIn"} className="size-4" /></span>
                  <span className="min-w-0 flex-1">
                    <b className="block break-words text-heading">{t.label || "—"}</b>
                    <small className="block text-label text-faint">{t.category ?? "Sans catégorie"} · {t.paidBy}</small>
                  </span>
                  <b className={`ab-num shrink-0 ${t.kind === "EXPENSE" ? "text-neg" : "text-pos"}`}>{t.kind === "EXPENSE" ? "−" : "+"}{money(t.amount)}</b>
                </div>
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
      <Summary title={`Bilan de ${monthLabel(new Date(`${input.month}-01`))}`} text={output.verdict} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Reste réel" value={money(input.actual.remaining)} tone={input.actual.remaining < input.planned.remaining ? "neg" : "pos"} note={`Prévu ${money(input.planned.remaining)}`} />
        <Stat label="Épargne réalisée" value={money(input.actual.savings)} tone={input.actual.savings < input.planned.savings ? "neg" : "pos"} note={`Prévu ${money(input.planned.savings)}`} />
        <Stat label="Hors budget" value={money(input.offBudget)} note="Dépenses sans ligne au budget" />
      </div>
      <Points title="Erreurs à éviter" items={output.mistakes} kind="alert" />
      <Points title="Recommandations pour le mois prochain" items={output.advice} kind="advice" />
      <Points title="Points tenus" items={output.respected} kind="done" />

      <Card variant="table">
        <SectionHeader title="Prévu contre réel" />
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Ligne</th>
                <th className="hidden md:table-cell">Type</th>
                <th className="num hidden sm:table-cell">Prévu</th>
                <th className="num">Réel</th>
                <th className="num">Écart</th>
              </tr>
            </thead>
            <tbody>
              {input.lines.map((l, i) => {
                // Écart défavorable : dépense au-dessus du prévu, revenu en dessous.
                const bad = l.group === "income" ? l.diff < 0 : l.diff > 0;
                return (
                  <tr key={i}>
                    <td className="break-words">{l.label}<small className="block text-label font-medium text-faint md:hidden">{GROUPS[l.group]}<span className="sm:hidden"> · prévu {money(l.planned)}</span></small></td>
                    <td className="hidden text-muted md:table-cell">{GROUPS[l.group]}</td>
                    <td className="num hidden sm:table-cell">{money(l.planned)}</td>
                    <td className="num">{money(l.actual)}</td>
                    <td className={`num font-bold ${l.diff && bad ? "text-neg" : l.diff ? "text-pos" : ""}`}>{l.diff > 0 ? "+" : ""}{money(l.diff)}</td>
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
      <Card variant="table">
        <SectionHeader title={`Répartition proposée · ${monthLabel(new Date(`${input.month}-01`))}`} subtitle="Moyenne des 3 derniers mois de dépenses réelles en repère." />
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Ligne</th>
                <th className="num hidden md:table-cell">Moy. 3 mois</th>
                <th className="num hidden sm:table-cell">Prévu actuel</th>
                <th className="num">Proposé</th>
                <th className="hidden lg:table-cell">Pourquoi</th>
              </tr>
            </thead>
            <tbody>
              {input.lines.map((l) => (
                <tr key={l.id}>
                  <td className="break-words">{l.label}<small className="block text-label font-medium text-faint lg:hidden">{proposed.get(l.id)?.reason}</small></td>
                  <td className="num hidden text-muted md:table-cell">{money(avg(l.history))}</td>
                  <td className="num hidden text-muted sm:table-cell">{money(l.planned)}</td>
                  <td className="num font-bold text-heading">{money(proposed.get(l.id)?.amount ?? 0)}</td>
                  <td className="hidden text-muted lg:table-cell">{proposed.get(l.id)?.reason}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-bold text-heading">
                <td>Total</td>
                <td className="num hidden md:table-cell">{money(input.lines.reduce((s, l) => s + avg(l.history), 0))}</td>
                <td className="num hidden sm:table-cell">{money(input.lines.reduce((s, l) => s + l.planned, 0))}</td>
                <td className="num">{money(output.lines.reduce((s, l) => s + l.amount, 0))}</td>
                <td className="hidden lg:table-cell" />
              </tr>
            </tfoot>
          </table>
        </div>
        <ActionForm action={applyPlanAction} className="form px-3 pb-3">
          <input type="hidden" name="reportId" value={reportId} />
          <button type="submit" disabled={!!locked} aria-describedby={locked ? "plan-locked" : undefined} className="self-start">Appliquer au budget</button>
          {locked && <p id="plan-locked" className="m-0 text-label text-muted">{locked}</p>}
        </ActionForm>
      </Card>
      <Points title="Recommandation" items={output.advice ? [output.advice] : []} kind="advice" />
    </>
  );
}
