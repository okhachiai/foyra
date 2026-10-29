import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { accountBalance, formatDay } from "@/lib/ledger";
import { formatCents } from "@/lib/money";
import { archiveAccountAction } from "../../actions";
import { ActionForm } from "../../form";
import { KIND_LABELS } from "../kinds";
import { loadAccount } from "./load";

const PAGE_SIZE = 50;

export default async function AccountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string }> }) {
  const user = await requireUser();
  const account = await loadAccount(user.householdId, (await params).id);
  const page = Math.max(1, Number.parseInt((await searchParams).page ?? "1", 10) || 1);
  const currency = user.household.currency;
  const where = { householdId: user.householdId, accountId: account.id };

  const [balance, count, rows] = await Promise.all([
    accountBalance(user.householdId, account.id),
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
        where: { householdId: user.householdId, transferId: { in: transferIds }, accountId: { not: account.id } },
        select: { transferId: true, account: { select: { name: true } } },
      })
    : [];
  const otherName = new Map(others.map((o) => [o.transferId, o.account.name]));
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const active = !account.archivedAt;

  return (
    <>
      <p><Link href="/accounts">← Comptes</Link></p>
      <h1>{account.name}</h1>
      <p className="muted">{KIND_LABELS[account.kind]}{account.archivedAt && " · archivé"}</p>
      <section className="total">
        <span className="muted">Solde</span>
        <strong className={balance < 0 ? "neg" : undefined}>{formatCents(balance, currency)}</strong>
      </section>

      {active && (
        <div className="actions">
          <Link href={`/accounts/${account.id}/entries/new`} className="button">Dépense / recette</Link>
          <Link href={`/accounts/${account.id}/transfers/new`} className="button secondary">Virement</Link>
          <Link href={`/accounts/${account.id}/edit`} className="button secondary">Modifier</Link>
          <ActionForm action={archiveAccountAction} className="inline" confirm="Archiver ce compte ? Plus aucune saisie ne sera possible.">
            <input type="hidden" name="id" value={account.id} />
            <button type="submit" className="secondary">Archiver</button>
          </ActionForm>
        </div>
      )}

      <h2>Historique</h2>
      {rows.length === 0 && <p className="muted">Aucune opération.</p>}
      <ul className="list">
        {rows.map((t) => {
          const credit = t.kind === "INCOME" || t.transferSide === "IN";
          const label =
            t.kind === "TRANSFER"
              ? `Virement ${t.transferSide === "OUT" ? "vers" : "depuis"} ${otherName.get(t.transferId) ?? "?"}`
              : t.kind === "INCOME" ? "Recette" : "Dépense";
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
