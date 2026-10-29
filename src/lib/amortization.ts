// Échéancier d'un crédit amortissable : fonctions pures (aucun accès base), montants en centimes.

/** Échéance d'une charge pour un mois (1er du mois UTC) : min(jour, dernier jour du mois). */
export function dueDate(charge: { dueDay: number }, month: Date) {
  const y = month.getUTCFullYear(), m = month.getUTCMonth();
  return new Date(Date.UTC(y, m, Math.min(charge.dueDay, new Date(Date.UTC(y, m + 1, 0)).getUTCDate())));
}

const addMonths = (month: Date, n: number) => new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + n, 1));

/** Intérêts d'un mois : taux annuel en millièmes de pour cent (1,2 % → 1200). */
const interestOf = (balance: number, annualRate: number) => Math.round((balance * annualRate) / 1_200_000);

/** Mensualité constante (hors assurance) arrondie au centime ; taux 0 → capital / n. */
export function annuity(principal: number, annualRate: number, n: number) {
  if (annualRate === 0) return Math.round(principal / n);
  const i = annualRate / 1_200_000;
  return Math.round((principal * i) / (1 - (1 + i) ** -n));
}

/** Intérêts de la 1ʳᵉ échéance : une mensualité saisie doit les dépasser. */
export const firstInterest = (principal: number, annualRate: number) => interestOf(principal, annualRate);

export type LoanTerms = {
  principal: number; annualRate: number; termMonths: number; payment: number | null; insurance: number;
  dueDay: number; startMonth: Date; // 1ʳᵉ échéance = dueDate(dueDay, startMonth)
};
export type Prepayment = { occurredOn: Date; amount: number; mode: "REDUCE_TERM" | "REDUCE_PAYMENT" };
export type ScheduleRow = {
  n: number; month: Date; due: Date; interest: number; principal: number; insurance: number; total: number; balance: number;
};
export type Schedule = { rows: ScheduleRow[]; prepayments: (Prepayment & { balance: number })[] };

/**
 * Échéancier : la dernière échéance solde le capital (absorbe les arrondis) ; arrêt dès que le capital est soldé.
 * Un anticipé s'applique avant la 1ʳᵉ échéance postérieure à sa date (le jour même : après l'échéance),
 * montant borné au capital restant ; `prepayments` dans l'ordre de création.
 */
export function buildSchedule(t: LoanTerms, prepayments: Prepayment[]): Schedule {
  const pending = prepayments.map((p, i) => ({ p, i }))
    .sort((a, b) => a.p.occurredOn.getTime() - b.p.occurredOn.getTime() || a.i - b.i).map(({ p }) => p);
  const applied: Schedule["prepayments"] = [];
  const rows: ScheduleRow[] = [];
  let b = t.principal;
  let M = t.payment ?? annuity(t.principal, t.annualRate, t.termMonths);
  let last = t.termMonths; // échéance qui solde le capital restant (absorbe les arrondis)
  /** Échéances restantes à partir de k avec le solde et la mensualité courants (fin actuelle de l'échéancier). */
  const remaining = (k: number) => {
    let n = 0;
    for (let bal = b, j = k; bal > 0 && j <= last; j++, n++) {
      const i = interestOf(bal, t.annualRate);
      bal -= j === last || bal <= M - i ? bal : Math.max(0, M - i);
    }
    return n;
  };
  const apply = (before: (d: Date) => boolean, k: number) => {
    while (pending.length && before(pending[0].occurredOn)) {
      const p = pending.shift()!;
      const n = p.mode === "REDUCE_PAYMENT" ? remaining(k) : 0;
      const amount = Math.min(p.amount, b);
      b -= amount;
      applied.push({ ...p, amount, balance: b });
      if (n > 0 && b > 0) {
        M = annuity(b, t.annualRate, n);
        last = k + n - 1;
      }
    }
  };
  for (let k = 1; k <= last && b > 0; k++) {
    const month = addMonths(t.startMonth, k - 1);
    const due = dueDate(t, month);
    apply((d) => d < due, k);
    if (b === 0) break;
    const interest = interestOf(b, t.annualRate);
    const principal = k === last || b <= M - interest ? b : Math.max(0, M - interest);
    b -= principal;
    rows.push({ n: k, month, due, interest, principal, insurance: t.insurance, total: interest + principal + t.insurance, balance: b });
  }
  apply(() => true, last + 1); // anticipés postérieurs à la dernière échéance : bornés au capital restant (0)
  return { rows, prepayments: applied };
}

/** Situation au jour `today` : échéances dues (date ≤ today) et anticipés datés ≤ today, quels que soient les clics « payée ». */
export function loanStatus(s: Schedule, principal: number, today: Date) {
  const due = s.rows.filter((r) => r.due <= today);
  const prepaid = s.prepayments.filter((p) => p.occurredOn <= today).reduce((sum, p) => sum + p.amount, 0);
  const interestPaid = due.reduce((sum, r) => sum + r.interest, 0);
  return {
    balance: principal - due.reduce((sum, r) => sum + r.principal, 0) - prepaid,
    interestPaid,
    interestRemaining: s.rows.reduce((sum, r) => sum + r.interest, 0) - interestPaid,
  };
}
