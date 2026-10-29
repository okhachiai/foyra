import Link from "next/link";
import { getScope } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { listAccounts } from "@/lib/ledger";
import { formatCents } from "@/lib/money";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SettingsNav } from "../nav";
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
      <div className="row">
        <h1>Comptes</h1>
        <Link href="/accounts/new" className="button">Nouveau compte</Link>
      </div>
      <SettingsNav admin={user.role === "ADMIN"} />
      <section className="total">
        <span className="muted">Total des soldes accessibles (comptes actifs)</span>
        <strong className={total < 0 ? "neg" : undefined}>{formatCents(total, currency)}</strong>
      </section>
      {active.length === 0 && (
        <EmptyState title="Aucun compte actif" action={<ButtonLink href="/accounts/new">Créer mon premier compte</ButtonLink>}>
          Aucun compte n’est créé automatiquement : ajoutez vos comptes (courant, épargne, espèces, autre) avec leur solde initial.
        </EmptyState>
      )}
      <ul className="list">
        {active.map((a) => (
          <li key={a.id}>
            <Link href={`/accounts/${a.id}`}>
              <span>{a.name}<small className="muted">{KIND_LABELS[a.kind]} · {a.sharing === "HOUSEHOLD" ? "tout le foyer" : "membres sélectionnés"}</small></span>
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
