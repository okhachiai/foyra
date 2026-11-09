import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { formatMonth } from "@/lib/budget";
import { listCategories } from "@/lib/categories";
import { formatDay, NotFoundError, parseDay, todayIn } from "@/lib/ledger";
import { getLoan } from "@/lib/loans";
import { formatCents } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { DateTile } from "@/components/ui/date-tile";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { ProgressBar } from "@/components/ui/progress";
import { Stat } from "@/components/ui/stat";
import { deleteLoanAction, prepayLoanAction } from "@/app/actions";
import { ActionForm, Field } from "@/app/form";
import { duration, LoanForm, monthYear, rateToInput } from "../loan-form";

const frDay = (d: Date) => formatDay(d).split("-").reverse().join("/");

export default async function LoanPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const todayStr = todayIn(user.household.timezone);
  const today = parseDay(todayStr)!;
  const loan = await getLoan(user.householdId, (await params).id, today).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const c = loan.fixedCharge;
  const categories = await listCategories(user.householdId);
  const money = (cents: number) => formatCents(cents, user.household.currency);
  const { rows } = loan.schedule;
  const paid = new Map(c.payments.map((p) => [p.month.getTime(), p]));
  const next = rows.find((r) => r.due >= today);
  const left = rows.filter((r) => r.due >= today).length;
  const repaid = loan.principal - loan.status.balance;

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/credits" className="text-[inherit] no-underline hover:underline">Foyra / Crédits</Link>}
        title={c.name}
        subtitle={rows.length ? `Fin prévue ${monthYear(rows.at(-1)!.month)} · ${left} échéance${left > 1 ? "s" : ""} restante${left > 1 ? "s" : ""}` : "Aucune échéance"}
        actions={
          <>
            <Link href="/credits" className="button ghost"><Icon name="chevronLeft" className="size-4" />Crédits</Link>
            <a href="#anticipe" className="button secondary">Remboursement anticipé</a>
          </>
        }
      />

      <div className="dash-kpis">
        <Card variant="hero" className="kpi-card">
          <div className="kpi-top">
            <span className="kpi-icon hero"><Icon name="bank" className="size-4" /></span>
            <span className="kpi-title">Capital restant dû au {frDay(today)}</span>
          </div>
          <strong className="kpi-value">{money(loan.status.balance)}</strong>
          <ProgressBar value={repaid} max={loan.principal} label="Capital remboursé" />
          <span className="kpi-note">{money(repaid)} remboursés sur {money(loan.principal)}</span>
        </Card>
        <Stat label="Mensualité" value={next ? money(next.total) : "—"} note={next ? `Prochaine le ${frDay(next.due)}${loan.insurance > 0 ? ` · dont assurance ${money(loan.insurance)}` : ""}` : "Crédit soldé"} />
        <Stat label="Taux annuel" value={loan.annualRate ? `${rateToInput(loan.annualRate)} %` : "0 %"} note={loan.annualRate ? `Intérêts payés ${money(loan.status.interestPaid)}` : "Crédit sans intérêts"} />
        <Stat label="Durée restante" value={duration(left)} note={loan.annualRate ? `Intérêts restants ${money(loan.status.interestRemaining)}` : `${rows.length} échéances au total`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <Card variant="table" className="lg:col-span-8 lg:self-start">
          <SectionHeader title="Tableau d’amortissement" subtitle={`${rows.length} échéances · statut d’après les paiements enregistrés`} />
          <div className="table-wrap table-tall">
            <table className="table">
              <thead>
                <tr>
                  <th className="hidden sm:table-cell">N°</th>
                  <th>Date</th>
                  <th className="num">Échéance</th>
                  <th className="num hidden md:table-cell">Intérêts</th>
                  <th className="num">Restant dû</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isPaid = paid.has(r.month.getTime());
                  const isNext = r === next;
                  return (
                    <tr key={r.n} aria-current={isNext ? "step" : undefined} className={isNext ? "is-next" : undefined}>
                      <td className="hidden text-muted sm:table-cell">{r.n}</td>
                      <td className="whitespace-nowrap">{frDay(r.due)}</td>
                      <td className="num">{money(r.total)}</td>
                      <td className="num hidden text-muted md:table-cell">{money(r.interest)}</td>
                      <td className="num font-bold text-heading">{money(r.balance)}</td>
                      <td>
                        <Link href={`/charges?m=${formatMonth(r.month)}`} className="no-underline" aria-label={`Échéance du ${frDay(r.due)} : ${isPaid ? "payée" : "à payer"}, voir les charges du mois`}>
                          <Badge dot tone={isPaid ? "success" : r.due < today ? "danger" : "muted"}>{isPaid ? "Payée" : r.due < today ? "À payer" : "À venir"}</Badge>
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="flex flex-col gap-4 lg:col-span-4">
          <Card id="anticipe">
            <SectionHeader title="Remboursement anticipé" subtitle={`Crée la dépense sur ${c.name} : supprimer cette dépense annule le remboursement.`} />
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
              <button type="submit">Enregistrer le remboursement</button>
            </ActionForm>
          </Card>

          <Card>
            <SectionHeader title="Remboursements anticipés" subtitle={loan.prepayments.length ? `${loan.prepayments.length} enregistré${loan.prepayments.length > 1 ? "s" : ""}` : undefined} />
            {loan.prepayments.length === 0 ? (
              <p className="m-0 text-label text-muted">Aucun remboursement anticipé.</p>
            ) : (
              <ul className="due-list">
                {loan.prepayments.map((p) => (
                  <li key={p.id}>
                    <Link href={`/operations/${p.transaction.id}`}>
                      <DateTile date={p.transaction.occurredOn} />
                      <span className="min-w-0 flex-1">
                        <b className="block truncate text-heading">{p.mode === "REDUCE_TERM" ? "Réduction de durée" : "Réduction de mensualité"}</b>
                        <small className="block text-label text-faint">{frDay(p.transaction.occurredOn)} · voir la dépense</small>
                      </span>
                      <b className="ab-num shrink-0 text-heading">{money(p.transaction.amount)}</b>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <SectionHeader title="Conditions" />
            <dl className="facts-list">
              <div><dt>Capital emprunté</dt><dd>{money(loan.principal)}</dd></div>
              <div><dt>Première échéance</dt><dd>{frDay(loan.firstDue)}</dd></div>
              {loan.insurance > 0 && <div><dt>Assurance mensuelle</dt><dd>{money(loan.insurance)}</dd></div>}
              <div><dt>Intérêts payés</dt><dd>{money(loan.status.interestPaid)}</dd></div>
              <div><dt>Intérêts restants</dt><dd>{money(loan.status.interestRemaining)}</dd></div>
              <div><dt>Fin</dt><dd>{rows.length ? monthYear(rows.at(-1)!.month) : "—"}</dd></div>
            </dl>
          </Card>
        </div>
      </div>

      <details className="card mt-4 p-5 sm:p-6">
        <summary className="m-0">Modifier le crédit</summary>
        <LoanForm loan={loan} categories={categories} firstDue="" />
      </details>

      <Card className="danger-card mt-4">
        <SectionHeader title="Supprimer le crédit" subtitle="Les dépenses déjà payées et les remboursements anticipés sont conservés comme dépenses." />
        <ActionForm action={deleteLoanAction} confirm="Supprimer ce crédit ? Les dépenses déjà payées et les remboursements anticipés sont conservés comme dépenses.">
          <input type="hidden" name="id" value={loan.id} />
          <div className="form-actions"><button type="submit" className="danger">Supprimer le crédit</button></div>
        </ActionForm>
      </Card>
    </>
  );
}
