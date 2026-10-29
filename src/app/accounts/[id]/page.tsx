import Link from "next/link";
import { canManage, canWrite, getScope, readable } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { accountBalance, formatDay, todayIn, writableAccounts } from "@/lib/ledger";
import { centsToInput, formatCents } from "@/lib/money";
import { adjustBalanceAction, archiveAccountAction, deleteAccountAction } from "../../actions";
import { ActionForm, Field } from "../../form";
import { KIND_LABELS } from "../kinds";
import { loadAccount } from "./load";
import { TransferForm } from "./tx-forms";

const PAGE_SIZE = 50;

export default async function AccountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string; virement?: string; montant?: string }> }) {
  const user = await requireUser();
  const scope = await getScope(user);
  const account = await loadAccount(scope, (await params).id, "READ");
  const query = await searchParams;
  const page = Math.max(1, Number.parseInt(query.page ?? "1", 10) || 1);
  const currency = user.household.currency;
  const where = { householdId: user.householdId, accountId: account.id };

  const [balance, count, rows] = await Promise.all([
    accountBalance(scope, account.id),
    prisma.transaction.count({ where }),
    prisma.transaction.findMany({
      where,
      orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { createdBy: { select: { name: true } }, category: { select: { name: true, parent: { select: { name: true } } } } },
    }),
  ]);

  // Compte d'en face pour chaque ligne de virement.
  const transferIds = rows.flatMap((r) => (r.transferId ? [r.transferId] : []));
  const others = transferIds.length
    ? await prisma.transaction.findMany({
        where: { householdId: user.householdId, transferId: { in: transferIds }, AND: [{ accountId: { not: account.id } }, { accountId: readable(scope) }] },
        select: { transferId: true, account: { select: { name: true } } },
      })
    : [];
  const otherName = new Map(others.map((o) => [o.transferId, o.account.name]));
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  // Saisie et modification : compte actif et modifiable par l'utilisateur.
  const active = !account.archivedAt && canWrite(scope, account.id);
  const manager = canManage(scope, account.id);
  const access = manager ? "Gestion" : canWrite(scope, account.id) ? "Écriture" : "Lecture";
  const today = todayIn(user.household.timezone);
  // `?virement=<compte>&montant=<centimes>` : virement pré-rempli depuis ce compte (ex. « Reste à virer »).
  const accounts = active && query.virement ? await writableAccounts(scope) : [];
  const transferTo = accounts.some((a) => a.id === query.virement && a.id !== account.id) ? query.virement : undefined;
  const transferAmount = Number.parseInt(query.montant ?? "", 10);

  return (
    <>
      <p><Link href="/accounts">← Comptes</Link></p>
      <h1>{account.name}</h1>
      <p className="muted">
        {KIND_LABELS[account.kind]}{account.archivedAt && " · archivé"} · {account.sharing === "HOUSEHOLD" ? "partagé avec tout le foyer" : "membres sélectionnés"} · votre accès : {access}
      </p>
      {account.notes && <p className="whitespace-pre-line">{account.notes}</p>}
      <section className="total">
        <span className="muted">Solde</span>
        <strong className={balance < 0 ? "neg" : undefined}>{formatCents(balance, currency)}</strong>
      </section>

      {transferTo && (
        <details open>
          <summary>Virement</summary>
          <TransferForm
            accounts={accounts} from={account.id} to={transferTo} returnTo={account.id}
            v={{ occurredOn: today, amount: transferAmount > 0 ? transferAmount : undefined }}
          />
        </details>
      )}

      <div className="actions">
        {active && (
          <>
            <Link href={`/accounts/${account.id}/entries/new`} className="button">Dépense / revenu</Link>
            <Link href={`/accounts/${account.id}/transfers/new`} className="button secondary">Virement</Link>
          </>
        )}
        {manager && !account.archivedAt && <Link href={`/accounts/${account.id}/edit`} className="button secondary">Modifier</Link>}
        {manager && <Link href={`/accounts/${account.id}/partage`} className="button secondary">Partage</Link>}
        {manager && (
          <ActionForm
            action={archiveAccountAction} className="inline"
            confirm={account.archivedAt ? undefined : "Archiver ce compte ? Ses opérations sont conservées ; plus aucune saisie ne sera possible jusqu’à sa réactivation."}
          >
            <input type="hidden" name="id" value={account.id} />
            <input type="hidden" name="restore" value={account.archivedAt ? "1" : "0"} />
            <button type="submit" className="secondary">{account.archivedAt ? "Réactiver" : "Archiver"}</button>
          </ActionForm>
        )}
        {manager && (
          <ActionForm
            action={deleteAccountAction} className="inline"
            confirm="Supprimer définitivement ce compte et toutes ses opérations ? Cette action est irréversible."
          >
            <input type="hidden" name="id" value={account.id} />
            <button type="submit" className="danger">Supprimer</button>
          </ActionForm>
        )}
      </div>

      {active && (
        <details>
          <summary>Ajuster le solde</summary>
          <ActionForm action={adjustBalanceAction}>
            <input type="hidden" name="id" value={account.id} />
            <Field name="target" label="Nouveau solde (une opération d’écart est créée à la date du jour)">
              <input name="target" inputMode="decimal" required autoComplete="off" defaultValue={centsToInput(balance)} />
            </Field>
            <button type="submit">Ajuster</button>
          </ActionForm>
        </details>
      )}

      <h2>Historique</h2>
      {rows.length === 0 && <p className="muted">Aucune opération.</p>}
      <ul className="list">
        {rows.map((t) => {
          const credit = t.kind === "INCOME" || t.transferSide === "IN";
          const label =
            t.kind === "TRANSFER"
              ? `Virement ${t.transferSide === "OUT" ? "vers" : "depuis"} ${otherName.get(t.transferId) ?? "compte non partagé"}`
              : t.kind === "INCOME" ? "Revenu" : "Dépense";
          const content = (
            <>
              <span>
                {t.note || label}
                <small className="muted">{formatDay(t.occurredOn).split("-").reverse().join("/")} · {t.note ? `${label} · ` : ""}{t.category ? `${t.category.parent ? `${t.category.parent.name} › ` : ""}${t.category.name} · ` : ""}{t.createdBy.name}</small>
              </span>
              <span className={credit ? "amount pos" : "amount"}>{formatCents(credit ? t.amount : -t.amount, currency)}</span>
            </>
          );
          return <li key={t.id}>{active ? <Link href={`/accounts/${account.id}/transactions/${t.id}`}>{content}</Link> : <div>{content}</div>}</li>;
        })}
      </ul>
      {pages > 1 && (
        <nav className="pager">
          {page > 1 ? <Link href={`?page=${page - 1}`}>← Plus récentes</Link> : <span />}
          <span className="muted">Page {page} / {pages}</span>
          {page < pages ? <Link href={`?page=${page + 1}`}>Plus anciennes →</Link> : <span />}
        </nav>
      )}
    </>
  );
}
