import type { PrepaymentMode } from "@prisma/client";
import { addMonths, buildSchedule, dueDate, interestOf, loanStatus, type Schedule } from "./amortization";
import { checkRefs, type ChargeInput } from "./charges";
import { prisma, type Db } from "./db";
import { createEntryTx, isCode, LedgerError, NotFoundError } from "./ledger";

export type LoanInput = {
  name: string; categoryId: string; firstDue: Date;
  principal: number; annualRate: number; termMonths: number; payment: number | null; insurance: number;
};

const loanTerms = (i: LoanInput) => ({ principal: i.principal, annualRate: i.annualRate, termMonths: i.termMonths, payment: i.payment, insurance: i.insurance });

/** Charge portée par le crédit : jour et mois de la 1ʳᵉ échéance, n mois (montant : échéancier du crédit). Sans `shared` : défaut en base à la création, inchangé ensuite. */
function chargeOf(i: LoanInput): Omit<ChargeInput, "shared"> {
  if (i.payment !== null && i.payment <= interestOf(i.principal, i.annualRate)) {
    throw new LedgerError("The monthly payment does not cover the interest.", "payment");
  }
  const startMonth = addMonths(i.firstDue, 0);
  const dueDay = i.firstDue.getUTCDate();
  return {
    active: true, name: i.name, dueDay, categoryId: i.categoryId, startMonth,
    endMonth: addMonths(startMonth, i.termMonths - 1),
  };
}

export async function createLoan(householdId: string, input: LoanInput) {
  const charge = chargeOf(input);
  return prisma.$transaction(async (tx) => {
    await checkRefs(tx, householdId, charge);
    const c = await tx.fixedCharge.create({ data: { ...charge, householdId } });
    return tx.loan.create({ data: { ...loanTerms(input), householdId, fixedChargeId: c.id } });
  });
}

/** Modification complète : l'échéancier est recalculé (paiements et anticipés conservés). */
export async function updateLoan(householdId: string, id: string, input: LoanInput) {
  const charge = chargeOf(input);
  await prisma.$transaction(async (tx) => {
    const loan = await lockLoan(tx, householdId, id);
    await checkRefs(tx, householdId, charge);
    await tx.fixedCharge.update({ where: { id: loan.fixedChargeId }, data: charge });
    await tx.loan.update({ where: { id }, data: loanTerms(input) });
  });
}

/** Verrouille le crédit du foyer. */
async function lockLoan(tx: Db, householdId: string, id: string) {
  const [loan] = await tx.$queryRaw<{ fixedChargeId: string }[]>`
    SELECT "fixedChargeId" FROM "Loan" WHERE "id" = ${id} AND "householdId" = ${householdId} FOR UPDATE`;
  if (!loan) throw new NotFoundError();
  return loan;
}

/** Supprime la charge (et donc le crédit, ses paiements et anticipés) ; les dépenses sont conservées. */
export async function deleteLoan(householdId: string, id: string) {
  await prisma.$transaction(async (tx) => {
    const loan = await lockLoan(tx, householdId, id);
    await tx.fixedCharge.deleteMany({ where: { id: loan.fixedChargeId, householdId } });
  });
}

const INCLUDE = {
  fixedCharge: { include: { payments: { include: { transaction: true } } } },
  prepayments: { include: { transaction: true }, orderBy: { createdAt: "asc" } },
} as const;

type FullLoan = NonNullable<Awaited<ReturnType<typeof findLoan>>>;
const findLoan = (householdId: string, id: string, db: Pick<typeof prisma, "loan"> = prisma) =>
  db.loan.findFirst({ where: { id, householdId }, include: INCLUDE });

const termsOf = (loan: FullLoan) => ({ ...loan, dueDay: loan.fixedCharge.dueDay, startMonth: loan.fixedCharge.startMonth });
const prepaymentsOf = (loan: FullLoan) =>
  loan.prepayments.map((p) => ({ occurredOn: p.transaction.occurredOn, amount: p.transaction.amount, mode: p.mode }));

function withSchedule(loan: FullLoan, today: Date) {
  const c = loan.fixedCharge;
  const schedule = buildSchedule(termsOf(loan), prepaymentsOf(loan));
  return { ...loan, firstDue: dueDate(c, c.startMonth), schedule, status: loanStatus(schedule, loan.principal, today) };
}

/** Crédit + charge + paiements + anticipés (avec leur dépense), échéancier calculé et situation au jour `today`. */
export async function getLoan(householdId: string, id: string, today: Date) {
  const loan = await findLoan(householdId, id);
  if (!loan) throw new NotFoundError();
  return withSchedule(loan, today);
}

export async function listLoans(householdId: string, today: Date) {
  const loans = await prisma.loan.findMany({ where: { householdId }, include: INCLUDE, orderBy: { createdAt: "asc" } });
  return loans.map((l) => withSchedule(l, today));
}

const TOO_MUCH = "Amount above the principal still owed on that date.";
const total = (s: Schedule) => s.prepayments.reduce((sum, p) => sum + p.amount, 0);

/** Tous les anticipés enregistrés s'appliquent en entier (aucun rogné par le capital restant) ; sinon LedgerError. Utilisé après un import. */
export async function checkPrepayments(tx: Db, householdId: string, loanId: string) {
  const loan = (await findLoan(householdId, loanId, tx))!;
  const given = prepaymentsOf(loan);
  if (total(buildSchedule(termsOf(loan), given)) < given.reduce((sum, p) => sum + p.amount, 0)) throw new LedgerError(TOO_MUCH, "amount");
}

/**
 * Remboursement anticipé (payé par `userId`) : contrôle du capital restant dû et dépense créés sous verrou du crédit.
 * Même `idempotencyKey` (double clic, nouvel envoi) : renvoie le remboursement déjà enregistré au lieu d'un doublon.
 */
export async function prepay(householdId: string, userId: string, loanId: string, amount: number, occurredOn: Date, mode: PrepaymentMode, idempotencyKey: string | null = null) {
  const existing = async () => {
    const t = idempotencyKey && (await prisma.transaction.findFirst({ where: { householdId, idempotencyKey }, select: { prepayment: true } }));
    return t ? t.prepayment : null;
  };
  try {
    return await prisma.$transaction(async (tx) => {
      await lockLoan(tx, householdId, loanId);
      const loan = withSchedule((await findLoan(householdId, loanId, tx))!, occurredOn);
      // Le nouvel anticipé doit s'appliquer en entier sans rogner ceux datés après lui.
      const after = buildSchedule(termsOf(loan), [...prepaymentsOf(loan), { occurredOn, amount, mode }]);
      if (total(after) < total(loan.schedule) + amount) throw new LedgerError(TOO_MUCH, "amount");
      const t = await createEntryTx(tx, householdId, userId, {
        kind: "EXPENSE", amount, occurredOn, paidById: userId, shared: loan.fixedCharge.shared, idempotencyKey,
        note: `Early repayment · ${loan.fixedCharge.name}`, categoryId: loan.fixedCharge.categoryId,
      });
      return tx.loanPrepayment.create({ data: { householdId, loanId, transactionId: t.id, mode } });
    });
  } catch (e) {
    if (!isCode(e, "P2002")) throw e;
    const p = await existing();
    if (!p) throw e;
    return p;
  }
}
