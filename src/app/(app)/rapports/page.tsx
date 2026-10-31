import Link from "next/link";
import type { ReportTrigger } from "@prisma/client";
import { addMonths } from "@/lib/amortization";
import { requireUser } from "@/lib/auth";
import { envelopes, getBudget } from "@/lib/budget";
import { listCategories } from "@/lib/categories";
import { prisma } from "@/lib/db";
import { formatDay, parseDay, todayIn } from "@/lib/ledger";
import { configuredProviders, PROVIDER_LABELS } from "@/lib/llm";
import { formatCents } from "@/lib/money";
import { listReports, STALE, type ReportInput, type ReportOutput } from "@/lib/report";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { analyzeAction, applyAllocationsAction, applyCategoriesAction } from "@/app/actions";
import { ActionForm, Field } from "@/app/form";

const TRIGGERS: Record<ReportTrigger, string> = { MANUAL: "À la demande", DAILY: "Quotidien" };
const frDay = (s: string) => s.split("-").reverse().join("/");
const TH = "py-2 pr-3 font-medium";
const TD = "py-2 pr-3";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ id?: string; lignes?: string; operations?: string }> }) {
  const user = await requireUser();
  const { id, lignes, operations } = await searchParams;
  const providers = configuredProviders();
  const reports = await listReports(user);
  const report = id ? reports.find((r) => r.id === id) : reports[0];
  const money = (cents: number) => formatCents(cents, user.household.currency);
  const when = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: user.household.timezone });

  return (
    <>
      <h1>Rapports</h1>
      {lignes && <p role="status" className="text-pos">Répartition appliquée : {lignes} ligne(s) du budget mise(s) à jour.</p>}
      {operations && <p role="status" className="text-pos">Catégories appliquées : {operations} opération(s) modifiée(s).</p>}

      {providers.length > 0 && (
        <ActionForm action={analyzeAction} className="form mb-4">
          {providers.length > 1 && (
            <Field name="provider" label="Fournisseur">
              <select name="provider" defaultValue="">
                <option value="">Réglage du foyer</option>
                {providers.map((p) => <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>)}
              </select>
            </Field>
          )}
          <button type="submit">Analyser</button>
        </ActionForm>
      )}

      {id && !report && <p className="error" role="alert">Rapport introuvable.</p>}
      {!report && !id && <EmptyState title="Aucun rapport">Les rapports générés apparaîtront ici.</EmptyState>}
      {report && <ReportView user={user} report={report} money={money} />}

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
                  <th className={TH}>Déclencheur</th>
                  <th className={TH}>Fournisseur</th>
                  <th className="py-2 font-medium">Statut</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id} className="border-t border-hairline">
                    <td className={TD}>
                      <Link href={`/rapports?id=${r.id}`} aria-current={r.id === report?.id ? "page" : undefined}>{when.format(r.createdAt)}</Link>
                    </td>
                    <td className={TD}>{TRIGGERS[r.trigger]}</td>
                    <td className={TD}>{PROVIDER_LABELS[r.provider]}</td>
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

type Report = Awaited<ReturnType<typeof listReports>>[number];
type User = Awaited<ReturnType<typeof requireUser>>;

/**
 * Un rapport : les chiffres « actuels » (opérations, enveloppes) sont relus maintenant par l'app ;
 * seules les propositions (allocations, catégories, planning, rééquilibrages, conseil) viennent du LLM.
 */
async function ReportView({ user, report, money }: { user: User; report: Report; money: (c: number) => string }) {
  const month = addMonths(report.day, 0);
  const input = report.input as ReportInput;
  const output = report.output as ReportOutput | null;
  const opIds = [...new Set([...input.todayOps, ...input.uncategorized].map((o) => o.id))];
  const [budget, categories, ops] = await Promise.all([
    getBudget(user.householdId, month),
    listCategories(user.householdId, { withArchived: true }),
    prisma.transaction.findMany({
      where: { id: { in: opIds }, householdId: user.householdId },
      include: { paidBy: { select: { name: true } }, category: { select: { name: true } } },
      orderBy: [{ occurredOn: "asc" }, { createdAt: "asc" }],
    }),
  ]);
  const catName = new Map(categories.flatMap((c) => [c, ...c.children]).map((c) => [c.id, c.name]));
  const proposed = new Map(output?.categorize.map((c) => [c.transactionId, c.categoryId]));
  const allocation = new Map(output?.allocations.map((a) => [a.budgetItemId, a.amount]));
  const member = new Map(input.members.map((m) => [m.id, m.name]));
  const itemLabel = new Map(budget?.tree.flatMap((n) => [n, ...n.children]).map((n) => [n.id, n.label]));
  const env = budget ? envelopes(budget.tree) : null;
  const rows = env ? [...env.lines, ...(env.reserve ? [env.reserve] : [])] : [];
  const sum = (f: (e: (typeof rows)[number]) => number) => rows.reduce((s, e) => s + f(e), 0);
  const validated = budget?.status === "VALIDATED";
  const stale = report.day.getTime() !== parseDay(todayIn(user.household.timezone))!.getTime();
  const locked = stale ? STALE : validated ? "Repasser le budget en brouillon pour appliquer" : null;

  return (
    <div className="grid gap-4">
      <p className="m-0 text-sm text-muted">
        Rapport du {frDay(formatDay(report.day))} · {TRIGGERS[report.trigger]} · {PROVIDER_LABELS[report.provider]}{report.model && ` (${report.model})`}
      </p>
      {report.error && <p className="error" role="alert">Le rapport a échoué : {report.error}</p>}

      {output && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Conseil</CardTitle>
            </CardHeader>
            <p className="m-0">{output.advice}</p>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Dépenses du jour et opérations sans catégorie</CardTitle>
            </CardHeader>
            {ops.length === 0 ? (
              <p className="m-0 text-sm text-muted">Aucune opération.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm tabular-nums">
                  <thead>
                    <tr className="text-left text-muted">
                      <th className={TH}>Date</th>
                      <th className={TH}>Libellé</th>
                      <th className={TH}>Payé par</th>
                      <th className={`${TH} text-right`}>Montant</th>
                      <th className={TH}>Catégorie</th>
                      <th className="py-2 font-medium">Catégorie proposée</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ops.map((t) => {
                      const p = proposed.get(t.id);
                      return (
                        <tr key={t.id} className="border-t border-hairline">
                          <td className={`${TD} whitespace-nowrap`}>{frDay(formatDay(t.occurredOn))}</td>
                          <td className={`${TD} break-words`}>{t.note ?? t.category?.name ?? ""}</td>
                          <td className={TD}>{t.paidBy.name}</td>
                          <td className={`${TD} text-right whitespace-nowrap ${t.kind === "EXPENSE" ? "text-heading" : "text-pos"}`}>{money(t.kind === "EXPENSE" ? -t.amount : t.amount)}</td>
                          <td className={TD}>{t.category?.name ?? <span className="text-muted">Sans catégorie</span>}</td>
                          <td className="py-2">{p && p !== t.categoryId ? catName.get(p) ?? "—" : <span className="text-muted">—</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {output.categorize.length > 0 && (
              <ActionForm action={applyCategoriesAction}>
                <input type="hidden" name="reportId" value={report.id} />
                <button type="submit" className="secondary">Appliquer les catégories</button>
              </ActionForm>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Budget actualisé</CardTitle>
              <CardDescription>Prévu, réel et restant recalculés maintenant ; allocation proposée par le rapport.</CardDescription>
            </CardHeader>
            {rows.length === 0 ? (
              <p className="m-0 text-sm text-muted">Aucune enveloppe commune.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm tabular-nums">
                  <thead>
                    <tr className="text-left text-muted">
                      <th className={TH}>Libellé</th>
                      <th className={`${TH} text-right`}>Prévu</th>
                      <th className={`${TH} text-right`}>Réel</th>
                      <th className={`${TH} text-right`}>Restant</th>
                      <th className="py-2 text-right font-medium">Allocation proposée</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((e) => (
                      <tr key={e.id} className="border-t border-hairline">
                        <td className={`${TD} break-words`}>
                          {e.label}
                          {e === env?.reserve && <small className="block text-xs text-muted">Réserve · dont {money(env.reserve.overrun)} de dépassements absorbés</small>}
                        </td>
                        <td className={`${TD} text-right whitespace-nowrap`}>{money(e.planned)}</td>
                        <td className={`${TD} text-right whitespace-nowrap`}>{money(e.actual)}</td>
                        <td className={`${TD} text-right whitespace-nowrap ${e.left < 0 ? "text-neg" : "text-heading"}`}>{money(e.left)}</td>
                        <td className="py-2 text-right whitespace-nowrap">{allocation.has(e.id) ? money(allocation.get(e.id)!) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-hairline font-medium">
                      <td className={TD}>Total</td>
                      <td className={`${TD} text-right whitespace-nowrap`}>{money(sum((e) => e.planned))}</td>
                      <td className={`${TD} text-right whitespace-nowrap`}>{money(sum((e) => e.actual))}</td>
                      <td className={`${TD} text-right whitespace-nowrap`}>{money(sum((e) => e.left))}</td>
                      <td className="py-2 text-right whitespace-nowrap">{money(sum((e) => allocation.get(e.id) ?? 0))}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
            {output.allocations.length > 0 && (
              <ActionForm action={applyAllocationsAction}>
                <input type="hidden" name="reportId" value={report.id} />
                <button type="submit" className="secondary" disabled={!!locked} aria-describedby={locked ? "alloc-locked" : undefined}>
                  Appliquer la répartition
                </button>
                {locked && <p id="alloc-locked" className="m-0 text-sm text-muted">{locked}</p>}
              </ActionForm>
            )}
          </Card>

          {output.plan.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Planning</CardTitle>
              </CardHeader>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm tabular-nums">
                  <thead>
                    <tr className="text-left text-muted">
                      <th className={TH}>Date</th>
                      <th className={TH}>Ligne</th>
                      <th className={TH}>Dépense</th>
                      <th className="py-2 text-right font-medium">Montant</th>
                    </tr>
                  </thead>
                  <tbody>
                    {output.plan.map((p, i) => (
                      <tr key={i} className="border-t border-hairline">
                        <td className={`${TD} whitespace-nowrap`}>{frDay(p.date)}</td>
                        <td className={TD}>{itemLabel.get(p.budgetItemId) ?? "—"}</td>
                        <td className={`${TD} break-words`}>{p.label}</td>
                        <td className="py-2 text-right whitespace-nowrap">{money(p.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {output.balancing.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Rééquilibrages</CardTitle>
              </CardHeader>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {output.balancing.map((b, i) => (
                  <li key={i}>
                    <strong>{member.get(b.fromUserId) ?? "?"}</strong> → <strong>{member.get(b.toUserId) ?? "?"}</strong> : {money(b.amount)}
                    <small className="block text-xs text-muted">{b.reason}</small>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
