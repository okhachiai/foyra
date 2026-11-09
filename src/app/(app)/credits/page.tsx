import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { parseDay, todayIn } from "@/lib/ledger";
import { listLoans } from "@/lib/loans";
import { formatCents } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { ProgressBar } from "@/components/ui/progress";
import { duration, monthYear, rateToInput } from "./loan-form";

export default async function LoansPage() {
  const user = await requireUser();
  const today = parseDay(todayIn(user.household.timezone))!;
  const loans = await listLoans(user.householdId, today);
  const money = (cents: number) => formatCents(cents, user.household.currency);

  return (
    <>
      <PageHeader
        eyebrow="Foyra / Crédits"
        title="Crédits"
        subtitle="Capital restant dû, mensualités et avancement de chaque crédit."
        actions={<Link href="/credits/new" className="button"><Icon name="plus" className="size-4" />Ajouter un crédit</Link>}
      />
      {loans.length === 0 ? (
        <EmptyState title="Aucun crédit" action={<Link href="/credits/new">Ajouter un crédit</Link>}>Les crédits enregistrés et leur tableau d’amortissement apparaîtront ici.</EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {loans.map((l) => {
            const rows = l.schedule.rows;
            const next = rows.find((r) => r.due >= today);
            const left = rows.filter((r) => r.due >= today).length;
            const repaid = l.principal - l.status.balance;
            return (
              <Card key={l.id}>
                <SectionHeader
                  title={<Link href={`/credits/${l.id}`} className="text-heading no-underline hover:underline">{l.fixedCharge.name}</Link>}
                  subtitle={rows.length > 0 ? `Fin ${monthYear(rows.at(-1)!.month)}` : undefined}
                  action={next ? <Badge dot tone="info">En cours</Badge> : <Badge dot tone="success">Soldé</Badge>}
                />
                <div>
                  <span className="text-label font-semibold text-muted">Capital restant dû</span>
                  <strong className="kpi-value block text-heading">{money(l.status.balance)}</strong>
                </div>
                <div className="flex flex-col gap-1.5">
                  <ProgressBar value={repaid} max={l.principal} label={`Remboursement de ${l.fixedCharge.name}`} />
                  <span className="text-label text-faint">{money(repaid)} remboursés sur {money(l.principal)}</span>
                </div>
                <dl className="loan-facts">
                  <div><dt>Mensualité</dt><dd className="ab-num">{next ? money(next.total) : "—"}</dd></div>
                  <div><dt>Taux</dt><dd className="ab-num">{l.annualRate ? `${rateToInput(l.annualRate)} %` : "Sans intérêts"}</dd></div>
                  <div><dt>Durée restante</dt><dd>{duration(left)}</dd></div>
                </dl>
                <div className="card-foot">
                  <span className="text-label text-muted">{next ? `Prochaine échéance le ${new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" }).format(next.due)}` : "Toutes les échéances sont passées"}</span>
                  <Link href={`/credits/${l.id}`} className="tap-link text-label font-bold" aria-label={`Détails de ${l.fixedCharge.name}`}>Détails</Link>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
