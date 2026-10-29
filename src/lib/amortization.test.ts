import { describe, expect, it } from "vitest";
import { buildSchedule, loanStatus, type LoanTerms, type Prepayment, type Schedule } from "./amortization";
import { formatDay, parseDay } from "./ledger";

const base: LoanTerms = { principal: 10_000_000, annualRate: 1200, termMonths: 240, payment: null, insurance: 0, dueDay: 5, startMonth: parseDay("2027-01-01")! };
const pre = (amount: number, mode: Prepayment["mode"], day = "2028-01-10"): Prepayment => ({ occurredOn: parseDay(day)!, amount, mode });
const month = (d: Date) => formatDay(d).slice(0, 7);

/** Σ capital amorti + Σ anticipés appliqués = capital ; solde final 0 ; aucune échéance négative. */
function invariants(s: Schedule, principal: number) {
  const sum = s.rows.reduce((a, r) => a + r.principal, 0) + s.prepayments.reduce((a, p) => a + p.amount, 0);
  expect(sum).toBe(principal);
  expect(Math.min(...s.rows.map((r) => r.balance))).toBe(0);
  expect(s.rows.every((r) => r.principal >= 0 && r.interest >= 0)).toBe(true);
}

describe("échéancier", () => {
  it("Annuité : 100 000 €, 1,2 %, 240 → 468,87 € ; 240ᵉ 469,35 € en 12/2046 ; intérêts 12 529,28 €", () => {
    const s = buildSchedule(base, []);
    expect(s.rows).toHaveLength(240);
    expect(s.rows[0]).toMatchObject({ total: 46887, interest: 10000, due: parseDay("2027-01-05") });
    expect(s.rows[239]).toMatchObject({ total: 46935, balance: 0 });
    expect(month(s.rows[239].month)).toBe("2046-12");
    expect(s.rows.reduce((a, r) => a + r.interest, 0)).toBe(1_252_928);
    invariants(s, base.principal);
  });

  it("Taux zéro : 200 €, 3 → 66,67 · 66,67 · 66,66", () => {
    const s = buildSchedule({ ...base, principal: 20000, annualRate: 0, termMonths: 3 }, []);
    expect(s.rows.map((r) => r.total)).toEqual([6667, 6667, 6666]);
    invariants(s, 20000);
  });

  it("Mensualité saisie 500 € : échéancier plus court, dernière < 500 €", () => {
    const s = buildSchedule({ ...base, payment: 50000 }, []);
    expect(s.rows.length).toBeLessThan(240);
    expect(s.rows.slice(0, -1).every((r) => r.total === 50000)).toBe(true);
    expect(s.rows.at(-1)!.total).toBeLessThan(50000);
    invariants(s, base.principal);
  });

  it("Assurance 15 € : chaque échéance = mensualité + 15 €", () => {
    const s = buildSchedule({ ...base, insurance: 1500 }, []);
    expect(s.rows[0].total).toBe(46887 + 1500);
    expect(s.rows.every((r) => r.total === r.interest + r.principal + 1500)).toBe(true);
  });

  it("Anticipé durée : 10 000 € le 10/01/2028 → mensualité inchangée, fin avancée", () => {
    const s = buildSchedule(base, [pre(1_000_000, "REDUCE_TERM")]);
    const ref = buildSchedule(base, []);
    expect(s.prepayments[0]).toMatchObject({ amount: 1_000_000, balance: ref.rows[12].balance - 1_000_000 }); // après l'échéance du 05/01/2028
    expect(s.rows[13].total).toBe(46887);
    expect(s.rows.length).toBeLessThan(240);
    invariants(s, base.principal);
  });

  it("Anticipé mensualité : fin 12/2046 inchangée, mensualité plus basse dès 02/2028", () => {
    const s = buildSchedule(base, [pre(1_000_000, "REDUCE_PAYMENT")]);
    expect(s.rows).toHaveLength(240);
    expect(month(s.rows[239].month)).toBe("2046-12");
    expect(s.rows[12].total).toBe(46887); // 01/2028 : avant l'anticipé
    expect(month(s.rows[13].month)).toBe("2028-02");
    expect(s.rows[13].total).toBeLessThan(46887);
    invariants(s, base.principal);
  });

  it("Anticipé mensualité après mensualité saisie 500 € : fin inchangée, mensualité plus basse", () => {
    const t = { ...base, payment: 50000 };
    const ref = buildSchedule(t, []);
    const s = buildSchedule(t, [pre(1_000_000, "REDUCE_PAYMENT")]);
    expect(month(s.rows.at(-1)!.month)).toBe(month(ref.rows.at(-1)!.month));
    expect(s.rows[13].total).toBeLessThan(50000);
    invariants(s, base.principal);
  });

  it("Soldé : anticipé = capital restant dû → plus aucune échéance après ; excédent borné", () => {
    const ref = buildSchedule(base, []);
    const s = buildSchedule(base, [pre(ref.rows[12].balance, "REDUCE_TERM"), pre(500, "REDUCE_TERM", "2029-01-01")]);
    expect(s.rows).toHaveLength(13);
    expect(s.prepayments.map((p) => p.amount)).toEqual([ref.rows[12].balance, 0]);
    expect(s.rows.at(-1)!.balance).toBe(ref.rows[12].balance);
    expect(s.prepayments.reduce((a, p) => a + p.amount, 0) + s.rows.reduce((a, r) => a + r.principal, 0)).toBe(base.principal);
  });

  it("Résumé au 06/01/2027 : 1 échéance due ; intérêts payés 100 €", () => {
    const s = buildSchedule(base, []);
    const st = loanStatus(s, base.principal, parseDay("2027-01-06")!);
    expect(st).toEqual({ balance: base.principal - s.rows[0].principal, interestPaid: 10000, interestRemaining: 1_252_928 - 10000 });
    expect(loanStatus(s, base.principal, parseDay("2027-01-04")!).balance).toBe(base.principal);
  });
});
