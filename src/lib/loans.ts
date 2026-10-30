import type { Prisma, PrepaymentMode } from "@prisma/client";
import { buildSchedule, dueDate, firstInterest, loanStatus, type Schedule } from "./amortization";
import { checkRefs, type ChargeInput } from "./charges";
import type { Scope } from "./access";
import { prisma } from "./db";
import { createEntryTx, LedgerError, NotFoundError } from "./ledger";

type Db = Prisma.TransactionClient;

export type LoanInput = {
  name: string; categoryId: string; firstDue: Date;
  principal: number; annualRate: number; termMonths: number; payment: number | null; insurance: number;
};

const loanTerms = (i: LoanInput) => ({ principal: i.principal, annualRate: i.annualRate, termMonths: i.termMonths, payment: i.payment, insurance: i.insurance });

/** Charge portée par le crédit : jour et mois de la 1ʳᵉ échéance, n mois (montant : échéancier du crédit). */
/** Sans `shared` : défaut en base à la création, inchangé ensuite. */
function chargeOf(i: LoanInput): Omit<ChargeInput, "shared"> {
  if (i.payment !== null && i.payment <= firstInterest(i.principal, i.annualRate)) {
    throw new LedgerError("La mensualité ne couvre pas les intérêts.", "payment");
  }
  const startMonth = new Date(Date.UTC(i.firstDue.getUTCFullYear(), i.firstDue.getUTCMonth(), 1));
  const dueDay = i.firstDue.getUTCDate();
  return {
    kind: "EXPENSE", active: true, name: i.name, dueDay, categoryId: i.categoryId, startMonth,
    endMonth: new Date(Date.UTC(startMonth.getUTCFullYear(), startMonth.getUTCMonth() + i.termMonths - 1, 1)),
  };
}

export async function createLoan(scope: Scope, input: LoanInput) {
  const charge = chargeOf(input);
  const householdId = scope.householdId;
  return prisma.$transaction(async (tx) => {
    await checkRefs(tx, scope, charge);
    const c = await tx.fixedCharge.create({ data: { ...charge, householdId } });
    return tx.loan.create({ data: { ...loanTerms(input), householdId, fixedChargeId: c.id } });
  });
}

/** Modification complète : l'échéancier est recalculé (paiements et anticipés conservés). */
export async function updateLoan(scope: Scope, id: string, input: LoanInput) {
  const charge = chargeOf(input);
  await prisma.$transaction(async (tx) => {
    const loan = await lockLoan(tx, scope, id);
    await checkRefs(tx, scope, charge);
    await tx.fixedCharge.update({ where: { id: loan.fixedChargeId }, data: charge });
    await tx.loan.update({ where: { id }, data: loanTerms(input) });
  });
}

/** Verrouille le crédit du foyer. */
async function lockLoan(tx: Db, scope: Scope, id: string) {
  const [loan] = await tx.$queryRaw<{ fixedChargeId: string }[]>`
    SELECT "fixedChargeId" FROM "Loan" WHERE "id" = ${id} AND "householdId" = ${scope.householdId} FOR UPDATE`;
  if (!loan) throw new NotFoundError();
  return loan;
}

/** Supprime la charge (et donc le crédit, ses paiements et anticipés) ; les dépenses sont conservées. */
export async function deleteLoan(scope: Scope, id: string) {
  await prisma.$transaction(async (tx) => {
    const loan = await lockLoan(tx, scope, id);
    await tx.fixedCharge.deleteMany({ where: { id: loan.fixedChargeId, householdId: scope.householdId } });
  });
}

const INCLUDE = {
  fixedCharge: { include: { payments: { include: { transaction: true } } } },
  prepayments: { include: { transaction: true }, orderBy: { createdAt: "asc" } },
} as const;

type FullLoan = NonNullable<Awaited<ReturnType<typeof findLoan>>>;
const findLoan = (scope: Scope, id: string, db: Pick<typeof prisma, "loan"> = prisma) =>
  db.loan.findFirst({ where: { id, householdId: scope.householdId }, include: INCLUDE });

const termsOf = (loan: FullLoan) => ({ ...loan, dueDay: loan.fixedCharge.dueDay, startMonth: loan.fixedCharge.startMonth });
const prepaymentsOf = (loan: FullLoan) =>
  loan.prepayments.map((p) => ({ occurredOn: p.transaction.occurredOn, amount: p.transaction.amount, mode: p.mode }));

function withSchedule(loan: FullLoan, today: Date) {
  const c = loan.fixedCharge;
  const schedule = buildSchedule(termsOf(loan), prepaymentsOf(loan));
  return { ...loan, firstDue: dueDate(c, c.startMonth), schedule, status: loanStatus(schedule, loan.principal, today) };
}

/** Crédit + charge + paiements + anticipés (avec leur dépense), échéancier calculé et situation au jour `today`. */
export async function getLoan(scope: Scope, id: string, today: Date) {
  const loan = await findLoan(scope, id);
  if (!loan) throw new NotFoundError();
  return withSchedule(loan, today);
}

export async function listLoans(scope: Scope, today: Date) {
  const loans = await prisma.loan.findMany({ where: { householdId: scope.householdId }, include: INCLUDE, orderBy: { createdAt: "asc" } });
  return loans.map((l) => withSchedule(l, today));
}

/** Remboursement anticipé (payé par `userId`) : contrôle du capital restant dû et dépense créés sous verrou du crédit. */
export async function prepay(scope: Scope, userId: string, loanId: string, amount: number, occurredOn: Date, mode: PrepaymentMode) {
  return prisma.$transaction(async (tx) => {
    await lockLoan(tx, scope, loanId);
    const loan = withSchedule((await findLoan(scope, loanId, tx))!, occurredOn);
    // Le nouvel anticipé doit s'appliquer en entier sans rogner ceux datés après lui.
    const total = (s: Schedule) => s.prepayments.reduce((sum, p) => sum + p.amount, 0);
    const after = buildSchedule(termsOf(loan), [...prepaymentsOf(loan), { occurredOn, amount, mode }]);
    if (total(after) < total(loan.schedule) + amount) throw new LedgerError("Montant supérieur au capital restant dû à cette date.", "amount");
    const t = await createEntryTx(tx, scope, userId, {
      kind: "EXPENSE", amount, occurredOn, paidById: userId, shared: loan.fixedCharge.shared,
      note: `Remboursement anticipé · ${loan.fixedCharge.name}`, categoryId: loan.fixedCharge.categoryId,
    });
    return tx.loanPrepayment.create({ data: { householdId: scope.householdId, loanId, transactionId: t.id, mode } });
  });
}
