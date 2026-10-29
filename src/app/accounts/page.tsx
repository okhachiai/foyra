import Link from "next/link";
import { getScope } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { listAccounts } from "@/lib/ledger";
import { formatCents } from "@/lib/money";
import { KIND_LABELS } from "./kinds";

export default async function AccountsPage() {
  const user = await requireUser();
  const currency = user.household.currency;
  const accounts = await listAccounts(await getScope(user));
  const active = accounts.filter((a) => !a.archivedAt);
  const archived = accounts.filter((a) => a.archivedAt);
  const total = active.reduce((s, a) => s + a.balance, 0);

  return (
    <>
      <section className="total">
        <span className="muted">Solde global</span>
        <strong className={total < 0 ? "neg" : undefined}>{formatCents(total, currency)}</strong>
      </section>
      <div className="row">
        <h1>Comptes</h1>
        <Link href="/accounts/new" className="button">Nouveau compte</Link>
      </div>
      {active.length === 0 && <p className="muted">Aucun compte pour l’instant.</p>}
      <ul className="list">
        {active.map((a) => (
          <li key={a.id}>
            <Link href={`/accounts/${a.id}`}>
              <span>{a.name}<small className="muted">{KIND_LABELS[a.kind]}</small></span>
              <span className={a.balance < 0 ? "amount neg" : "amount"}>{formatCents(a.balance, currency)}</span>
            </Link>
          </li>
        ))}
      </ul>
      {archived.length > 0 && (
        <details>
          <summary>Comptes archivés ({archived.length})</summary>
          <ul className="list">
            {archived.map((a) => (
              <li key={a.id}>
                <Link href={`/accounts/${a.id}`}><span>{a.name}<small className="muted">{KIND_LABELS[a.kind]}</small></span></Link>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
