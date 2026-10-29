import { readable, type Scope } from "./access";
import { addMonths, formatMonth } from "./budget";
import { listMonthCharges } from "./charges";
import { prisma } from "./db";
import { formatDay, listAccounts } from "./ledger";

export type ChargeStatus = "paid" | "late" | "due";

/** Payée = paiement du mois ; sinon en retard si l'échéance est passée (`today` = jour du foyer), sinon à payer. */
export const chargeStatus = (c: { payment: unknown; due: Date }, today: Date): ChargeStatus =>
  c.payment ? "paid" : c.due < today ? "late" : "due";

const monthOf = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

/**
 * Calendrier du mois : jours ayant au moins une échéance ou une opération (triés),
 * « À venir » (non payées jusqu'à today + 7 j, plus les retards du mois courant ; indépendant du mois consulté),
 * solde prévisionnel de fin de mois par compte actif (seulement si `month` est le mois courant).
 * Seuls les comptes lisibles comptent ; compte d'en face d'un virement non lisible → `otherAccount` null.
 */
export async function getCalendar(scope: Scope, month: Date, today: Date) {
  const current = monthOf(today);
  const cache = new Map<string, ReturnType<typeof listMonthCharges>>();
  const chargesOf = (m: Date) => {
    const k = formatMonth(m);
    if (!cache.has(k)) cache.set(k, listMonthCharges(scope, m));
    return cache.get(k)!;
  };
  const withStatus = async (m: Date) => (await chargesOf(m)).map((c) => ({ ...c, status: chargeStatus(c, today) }));

  const [charges, cur, nextCur, lines] = await Promise.all([
    withStatus(month),
    withStatus(current),
    withStatus(addMonths(current, 1)),
    prisma.transaction.findMany({
      where: {
        householdId: scope.householdId,
        accountId: readable(scope),
        occurredOn: { gte: month, lt: addMonths(month, 1) },
        fixedPayment: null, // déjà affichée sous l'échéance payée
      },
      include: {
        account: { select: { name: true, archivedAt: true } },
        category: { select: { name: true, parent: { select: { name: true } } } },
      },
      orderBy: [{ occurredOn: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  // Un virement une seule fois : côté OUT s'il est lisible, sinon côté IN. Les deux côtés ont la même date :
  // le compte d'en face, s'il est lisible, est donc dans `lines`.
  const sides = new Map(lines.flatMap((t) => (t.transferId ? [[`${t.transferId}:${t.transferSide}`, t.account.name] as const] : [])));
  const transactions = lines
    .filter((t) => t.transferSide !== "IN" || !sides.has(`${t.transferId}:OUT`))
    .map((t) => ({ ...t, otherAccount: t.transferId ? sides.get(`${t.transferId}:${t.transferSide === "OUT" ? "IN" : "OUT"}`) ?? null : null }));

  const days = new Map<string, { day: Date; charges: typeof charges; transactions: typeof transactions }>();
  const dayOf = (d: Date) => {
    const k = formatDay(d);
    if (!days.has(k)) days.set(k, { day: d, charges: [], transactions: [] });
    return days.get(k)!;
  };
  for (const c of charges) dayOf(c.due).charges.push(c);
  for (const t of transactions) dayOf(t.occurredOn).transactions.push(t);

  const limit = new Date(today.getTime() + 7 * 86_400_000);
  // Mois suivant : échéances toutes ≥ aujourd'hui ; mois courant : les passées non payées sont les retards.
  const upcoming = [...cur, ...nextCur].filter((c) => !c.payment && c.due <= limit).sort((a, b) => a.due.getTime() - b.due.getTime());

  let forecast = null;
  if (month.getTime() === current.getTime()) {
    const accounts = (await listAccounts(scope)).filter((a) => !a.archivedAt);
    forecast = accounts.map((a) => {
      const unpaid = cur.reduce((s, c) => s + (!c.payment && c.accountId === a.id ? c.amount : 0), 0);
      return { id: a.id, name: a.name, balance: a.balance, unpaid, end: a.balance - unpaid };
    });
  }

  return { days: [...days.values()].sort((a, b) => a.day.getTime() - b.day.getTime()), upcoming, forecast };
}
