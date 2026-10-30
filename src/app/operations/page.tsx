import Link from "next/link";
import { fullScope } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { addMonths, formatMonth, parseMonth } from "@/lib/budget";
import { prisma } from "@/lib/db";
import { formatDay, monthNet, todayIn } from "@/lib/ledger";
import { formatCents } from "@/lib/money";

const monthLabel = (month: Date) => new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(month);

/** Opérations réelles d'un mois (`?m=AAAA-MM`, mois courant par défaut) et leur net. */
export default async function OperationsPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const user = await requireUser();
  const month = parseMonth((await searchParams).m) ?? parseMonth(todayIn(user.household.timezone).slice(0, 7))!;
  const [net, rows] = await Promise.all([
    monthNet(fullScope(user.householdId), month),
    prisma.transaction.findMany({
      where: { householdId: user.householdId, occurredOn: { gte: month, lt: addMonths(month, 1) } },
      orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      include: { paidBy: { select: { name: true } }, category: { select: { name: true, parent: { select: { name: true } } } } },
    }),
  ]);
  const money = (cents: number) => formatCents(cents, user.household.currency);

  return (
    <>
      <nav className="pager">
        <Link href={`/operations?m=${formatMonth(addMonths(month, -1))}`}>← Précédent</Link>
        <h1>Opérations · {monthLabel(month)}</h1>
        <Link href={`/operations?m=${formatMonth(addMonths(month, 1))}`}>Suivant →</Link>
      </nav>
      <section className="total">
        <span className="muted">Net du mois (recettes − dépenses)</span>
        <strong className={net < 0 ? "neg" : undefined}>{money(net)}</strong>
      </section>
      <div className="actions">
        <Link href="/operations/new" className="button">Dépense / revenu</Link>
      </div>

      {rows.length === 0 && <p className="muted">Aucune opération ce mois-ci.</p>}
      <ul className="list">
        {rows.map((t) => {
          const credit = t.kind === "INCOME";
          const label = credit ? "Revenu" : "Dépense";
          const cat = t.category && `${t.category.parent ? `${t.category.parent.name} › ` : ""}${t.category.name}`;
          return (
            <li key={t.id}>
              <Link href={`/operations/${t.id}`}>
                <span>
                  {t.note || cat || label}
                  <small className="muted">
                    {formatDay(t.occurredOn).split("-").reverse().join("/")} · {[t.note ? label : null, t.note ? cat : null, t.shared ? "commune" : null, t.paidBy.name].filter(Boolean).join(" · ")}
                  </small>
                </span>
                <span className={credit ? "amount pos" : "amount"}>{money(credit ? t.amount : -t.amount)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
