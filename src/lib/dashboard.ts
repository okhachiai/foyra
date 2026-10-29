import type { Scope } from "./access";
import { available, getBudget } from "./budget";
import { chargeStatus } from "./calendar";
import { listAccounts } from "./ledger";

/**
 * Tableau de bord du mois de `today` (jour du foyer) : combien avons-nous, combien reste-t-il à payer,
 * combien pouvons-nous dépenser. Aucun calcul propre : soldes de listAccounts, budget de getBudget, statut de chargeStatus.
 */
export async function getDashboard(scope: Scope, today: Date) {
  const month = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const [accounts, budget] = await Promise.all([listAccounts(scope), getBudget(scope, month)]);
  const active = accounts.filter((a) => !a.archivedAt);

  // Ordre de listMonthCharges (par échéance) : les retards (échéance passée) sont déjà en tête.
  const unpaid = budget.charges.filter((c) => !c.payment).map((c) => ({ ...c, status: chargeStatus(c, today) }));
  const late = unpaid.filter((c) => c.status === "late");

  const categories = budget.rows
    .filter((r) => r.kind === "EXPENSE" && ((r.planned ?? 0) !== 0 || r.actual !== 0))
    .map((r) => ({ ...r, available: available(r) }))
    .sort((a, b) => Number(b.available < 0) - Number(a.available < 0)); // dépassements d'abord, ordre stable sinon

  return {
    month,
    accounts: active,
    total: active.reduce((s, a) => s + a.balance, 0),
    unpaid,
    toPay: unpaid.reduce((s, c) => s + c.amount, 0),
    late: { count: late.length, amount: late.reduce((s, c) => s + c.amount, 0) },
    restToLive: budget.totals.restToLive,
    categories,
  };
}
