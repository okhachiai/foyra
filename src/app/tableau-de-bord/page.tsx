import Link from "next/link";
import { getScope } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import type { ChargeStatus } from "@/lib/calendar";
import { listCategories } from "@/lib/categories";
import { getDashboard } from "@/lib/dashboard";
import { formatDay, parseDay, todayIn, writableAccounts } from "@/lib/ledger";
import { formatCents } from "@/lib/money";
import { KIND_LABELS } from "../accounts/kinds";
import { EntryForm } from "../accounts/[id]/tx-forms";

const monthLabel = (month: Date) => new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(month);
const frDay = (d: Date) => formatDay(d).split("-").reverse().join("/");
const STATUS: Record<ChargeStatus, [string, string]> = { paid: ["pos", "Payée"], late: ["neg", "En retard"], due: ["muted", "À payer"] };

export default async function DashboardPage() {
  const user = await requireUser();
  const todayStr = todayIn(user.household.timezone);
  const scope = await getScope(user);
  const [d, categories, writable] = await Promise.all([
    getDashboard(scope, parseDay(todayStr)!), listCategories(user.householdId), writableAccounts(scope),
  ]);
  const money = (cents: number) => formatCents(cents, user.household.currency);

  return (
    <>
      <h1>Tableau de bord · {monthLabel(d.month)}</h1>

      <section>
        <h2>Combien avons-nous ?</h2>
        <div className="total">
          <span className="muted">Solde global</span>
          <strong className={d.total < 0 ? "neg" : undefined}>{money(d.total)}</strong>
        </div>
        <ul className="list">
          {d.accounts.map((a) => (
            <li key={a.id}>
              <Link href={`/accounts/${a.id}`}>
                <span>{a.name}<small className="muted">{KIND_LABELS[a.kind]}</small></span>
                <span className={a.balance < 0 ? "amount neg" : "amount"}>{money(a.balance)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Combien devons-nous encore payer ?</h2>
        <div className="total">
          <span className="muted">Reste à payer ce mois-ci</span>
          <strong>{money(d.toPay)}</strong>
          {d.late.count > 0 && (
            <small className="neg">{d.late.count} en retard · {money(d.late.amount)}</small>
          )}
        </div>
        {d.unpaid.length === 0 ? (
          <p className="muted">Rien à payer ce mois-ci.</p>
        ) : (
          <ul className="list">
            {d.unpaid.map((c) => (
              <li key={c.id}>
                <Link href="/calendrier">
                  <span>{c.name}<small className={STATUS[c.status][0]}>{STATUS[c.status][1]} · {frDay(c.due)} · {c.account.name}</small></span>
                  <span className="amount">{money(c.amount)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Combien pouvons-nous dépenser ?</h2>
        <div className="total">
          <span className="muted">Reste à vivre</span>
          <strong className={d.restToLive < 0 ? "neg" : undefined}>{money(d.restToLive)}</strong>
          <small className="muted"><Link href="/budget">Voir le budget</Link></small>
        </div>
        {d.categories.length === 0 ? (
          <p className="muted">Aucun montant prévu ni dépensé ce mois-ci.</p>
        ) : (
          <ul className="list">
            {d.categories.map((r) => (
              <li key={r.id}>
                <Link href="/budget">
                  <span>{r.label}<small className={r.available < 0 ? "neg" : "muted"}>{r.available < 0 ? "Dépassement" : "Disponible"}</small></span>
                  <span className={r.available < 0 ? "amount neg" : "amount"}>{money(r.available)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {writable.length === 0 ? (
        <p><Link href="/accounts/new" className="button">Créer un compte</Link></p>
      ) : (
        <details>
          <summary>Nouvelle opération</summary>
          {/* Clé = solde global : une saisie réussie le change, le formulaire repart vide. */}
          <EntryForm key={d.total} accounts={writable} categories={categories} v={{ occurredOn: todayStr }} />
        </details>
      )}
    </>
  );
}
