import Link from "next/link";
import { getScope } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { parseDay, todayIn } from "@/lib/ledger";
import { listLoans } from "@/lib/loans";
import { formatCents } from "@/lib/money";
import { monthYear } from "./loan-form";

export default async function LoansPage() {
  const user = await requireUser();
  const today = parseDay(todayIn(user.household.timezone))!;
  const loans = await listLoans(await getScope(user), today);
  const money = (cents: number) => formatCents(cents, user.household.currency);

  return (
    <>
      <div className="row">
        <h1>Crédits</h1>
        <Link href="/credits/new" className="button secondary">Ajouter</Link>
      </div>
      {loans.length === 0 && <p className="muted">Aucun crédit.</p>}
      <ul className="list">
        {loans.map((l) => {
          const rows = l.schedule.rows;
          const next = rows.find((r) => r.due >= today);
          return (
            <li key={l.id}>
              <Link href={`/credits/${l.id}`}>
                <span>
                  {l.fixedCharge.name}
                  <small className="muted">
                    {next ? `Échéance ${money(next.total)}` : "Soldé"}
                    {rows.length > 0 && ` · fin ${monthYear(rows.at(-1)!.month)}`}
                  </small>
                </span>
                <span className="amount">{money(l.status.balance)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      {loans.length > 0 && <p className="muted"><small>Montant à droite : capital restant dû.</small></p>}
    </>
  );
}
