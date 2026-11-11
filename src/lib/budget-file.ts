import type { BudgetStatus, CategoryKind, PrepaymentMode } from "@prisma/client";
import { addMonths } from "./amortization";
import { formatMonth, lockBudget, parseMonth } from "./budget";
import { prisma } from "./db";
import { formatDay, LedgerError, parseDay } from "./ledger";
import { checkPrepayments } from "./loans";
import { MAX_CENTS } from "./money";

// Fichier d'un mois (JSON) : budget, opérations, paiements de charges et remboursements anticipés du mois,
// avec les catégories, charges / crédits et membres qu'ils utilisent. Les identifiants diffèrent d'une base à l'autre :
// dans le fichier, références par index dans la liste correspondante ; à l'import, rapprochement par nom (e-mail pour les membres).

type Ref = number;
type Kind = CategoryKind;
type FileLine = { kind: Kind; label: string; amount: number; included: boolean; recurring: boolean; shared: boolean; reserve: boolean; sortOrder: number; category: Ref | null };
type Loan = { principal: number; annualRate: number; termMonths: number; payment: number | null; insurance: number };

export type MonthFile = {
  version: 1;
  month: string; // AAAA-MM
  members: { email: string; name: string }[];
  categories: { kind: Kind; name: string; parent: Ref | null; fixed: boolean; savings: boolean }[]; // parent toujours avant ses enfants
  charges: { kind: "EXPENSE"; name: string; category: Ref; active: boolean; dueDay: number; startMonth: string; endMonth: string | null; shared: boolean; loan: Loan | null }[];
  budget: { status: BudgetStatus; items: (FileLine & { children: FileLine[] })[] } | null;
  transactions: {
    kind: Kind; amount: number; occurredOn: string; note: string | null; category: Ref | null; shared: boolean; paidBy: Ref; createdBy: Ref;
    payment: Ref | null; // charge réglée ce mois
    prepayment: { charge: Ref; mode: PrepaymentMode } | null; // remboursement anticipé du crédit de cette charge
  }[];
};

/** Liste + index : `ref(id)` ajoute l'objet à la première demande (`make` peut référencer d'autres objets avant lui). */
function indexer<T>(make: (id: string) => T) {
  const list: T[] = [], idx = new Map<string, number>();
  const ref = (id: string) => {
    let i = idx.get(id);
    if (i === undefined) idx.set(id, (i = list.push(make(id)) - 1));
    return i;
  };
  return { list, ref };
}

/** Tout le mois du foyer, prêt à sérialiser. */
export async function exportMonth(householdId: string, month: Date): Promise<MonthFile> {
  const next = addMonths(month, 1);
  const [budget, transactions, categories, users] = await Promise.all([
    prisma.budget.findUnique({ where: { householdId_month: { householdId, month } }, include: { items: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } } }),
    prisma.transaction.findMany({
      where: { householdId, occurredOn: { gte: month, lt: next } },
      include: { fixedPayment: true, prepayment: { include: { loan: true } } },
      orderBy: [{ occurredOn: "asc" }, { createdAt: "asc" }],
    }),
    prisma.category.findMany({ where: { householdId } }),
    prisma.user.findMany({ where: { householdId } }),
  ]);
  // Charges du mois (actives ou non) et celles réglées ou remboursées par une opération du mois.
  const linked = transactions.flatMap((t) => [t.fixedPayment?.fixedChargeId, t.prepayment?.loan.fixedChargeId].filter((id): id is string => !!id));
  const chargeRows = await prisma.fixedCharge.findMany({
    where: { householdId, OR: [{ startMonth: { lte: month }, OR: [{ endMonth: null }, { endMonth: { gte: month } }] }, { id: { in: linked } }] },
    include: { loan: true },
    orderBy: [{ dueDay: "asc" }, { name: "asc" }],
  });

  const catById = new Map(categories.map((c) => [c.id, c]));
  const cats = indexer((id): MonthFile["categories"][number] => {
    const c = catById.get(id)!;
    return { kind: c.kind, name: c.name, parent: c.parentId ? cats.ref(c.parentId) : null, fixed: c.fixed, savings: c.savings };
  });
  const cat = (id: string | null) => (id ? cats.ref(id) : null);
  const userById = new Map(users.map((u) => [u.id, u]));
  const members = indexer((id) => ({ email: userById.get(id)!.email, name: userById.get(id)!.name }));
  const chargeById = new Map(chargeRows.map((c) => [c.id, c]));
  const charges = indexer((id) => {
    const { name, categoryId, active, dueDay, startMonth, endMonth, shared, loan: l } = chargeById.get(id)!;
    const loan = l && { principal: l.principal, annualRate: l.annualRate, termMonths: l.termMonths, payment: l.payment, insurance: l.insurance };
    return { kind: "EXPENSE" as const, name, category: cats.ref(categoryId), active, dueDay, startMonth: formatMonth(startMonth), endMonth: endMonth && formatMonth(endMonth), shared, loan };
  });
  chargeRows.forEach((c) => charges.ref(c.id));

  const line = (i: NonNullable<typeof budget>["items"][number]): FileLine =>
    ({ kind: i.kind, label: i.label, amount: i.amount, included: i.included, recurring: i.recurring, shared: i.shared, reserve: i.reserve, sortOrder: i.sortOrder, category: cat(i.categoryId) });
  const items = budget?.items ?? [];
  const fileBudget = budget && {
    status: budget.status,
    items: items.filter((i) => !i.parentId).map((top) => ({ ...line(top), children: items.filter((c) => c.parentId === top.id).map(line) })),
  };
  const fileTransactions = transactions.map((t) => ({
    kind: t.kind, amount: t.amount, occurredOn: formatDay(t.occurredOn), note: t.note, category: cat(t.categoryId), shared: t.shared,
    paidBy: members.ref(t.paidById), createdBy: members.ref(t.createdById),
    payment: t.fixedPayment ? charges.ref(t.fixedPayment.fixedChargeId) : null,
    prepayment: t.prepayment ? { charge: charges.ref(t.prepayment.loan.fixedChargeId), mode: t.prepayment.mode } : null,
  }));
  return { version: 1, month: formatMonth(month), members: members.list, categories: cats.list, charges: charges.list, budget: fileBudget, transactions: fileTransactions };
}

// --- Lecture du fichier (envoyé par l'utilisateur : tout est vérifié avant d'écrire) ---

const fail = (what: string): never => {
  throw new LedgerError(`Fichier invalide : ${what}.`);
};
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const arr = (v: unknown, what: string) => (Array.isArray(v) ? v : fail(what));
// Borne haute : colonnes Int PostgreSQL.
const int = (v: unknown, what: string, min = 0, max = MAX_CENTS) => (Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? (v as number) : fail(what));
const bool = (v: unknown, what: string) => (typeof v === "boolean" ? v : fail(what));
const text = (v: unknown, what: string) => (typeof v === "string" && v.trim() && v.length <= 200 ? v : fail(what));
const oneOf = <T extends string>(v: unknown, values: readonly T[], what: string) => (values.includes(v as T) ? (v as T) : fail(what));
const ref = (v: unknown, len: number, what: string) => int(v, what, 0, len - 1);
const refOrNull = (v: unknown, len: number, what: string) => (v === null ? null : ref(v, len, what));
const KINDS = ["INCOME", "EXPENSE"] as const;

/** JSON exporté → MonthFile vérifié (types, bornes, références, dates dans le mois). Lève une LedgerError au message lisible. */
export function parseMonthFile(raw: string): MonthFile {
  let f: unknown;
  try {
    f = JSON.parse(raw);
  } catch {
    fail("JSON illisible");
  }
  if (!isObj(f) || f.version !== 1) fail("version inconnue (exportez à nouveau depuis Foyra)");
  const o = f as Record<string, unknown>;
  const month = typeof o.month === "string" ? parseMonth(o.month) : null;
  if (!month) fail("mois");
  const next = addMonths(month!, 1);
  const members = arr(o.members, "membres").map((m, k) => {
    if (!isObj(m)) fail(`membre ${k + 1}`);
    const x = m as Record<string, unknown>;
    return { email: text(x.email, `e-mail du membre ${k + 1}`), name: text(x.name, `nom du membre ${k + 1}`) };
  });
  const categories: MonthFile["categories"] = [];
  arr(o.categories, "catégories").forEach((c, k) => {
    if (!isObj(c)) fail(`catégorie ${k + 1}`);
    const what = `catégorie ${k + 1}`;
    const kind = oneOf(c.kind, KINDS, what);
    const parent = refOrNull(c.parent, k, what); // parent déjà lu
    if (parent !== null && categories[parent].kind !== kind) fail(what);
    categories.push({ kind, name: text(c.name, what), parent, fixed: bool(c.fixed, what), savings: bool(c.savings, what) });
  });
  const nc = categories.length;
  const charges = arr(o.charges, "charges").map((c, k) => {
    if (!isObj(c)) fail(`charge ${k + 1}`);
    const what = `charge ${k + 1}`;
    const startMonth = typeof c.startMonth === "string" && parseMonth(c.startMonth) ? c.startMonth : fail(what);
    const endMonth = c.endMonth === null ? null : typeof c.endMonth === "string" && parseMonth(c.endMonth) && c.endMonth >= startMonth ? c.endMonth : fail(what);
    let loan: Loan | null = null;
    if (c.loan !== null) {
      if (!isObj(c.loan)) fail(what);
      const l = c.loan as Record<string, unknown>;
      loan = {
        principal: int(l.principal, what, 1), annualRate: int(l.annualRate, what, 0, 50_000), termMonths: int(l.termMonths, what, 1, 600),
        payment: l.payment === null ? null : int(l.payment, what, 1), insurance: int(l.insurance, what),
      };
    }
    return {
      kind: oneOf(c.kind, ["EXPENSE"] as const, what), name: text(c.name, what), active: bool(c.active, what),
      category: categories[ref(c.category, nc, what)].kind === "EXPENSE" ? (c.category as number) : fail(`${what} (catégorie de recette)`),
      dueDay: int(c.dueDay, what, 1, 31), startMonth, endMonth, shared: bool(c.shared, what), loan,
    };
  });
  const line = (l: unknown, what: string, kind?: Kind): FileLine => {
    if (!isObj(l)) fail(what);
    const x = l as Record<string, unknown>;
    const k = oneOf(x.kind, KINDS, what);
    if (kind && k !== kind) fail(what);
    return {
      kind: k, label: text(x.label, what), amount: int(x.amount, what), included: bool(x.included, what), recurring: bool(x.recurring, what),
      shared: bool(x.shared, what), reserve: bool(x.reserve, what), sortOrder: int(x.sortOrder, what, -1e9, 1e9), category: refOrNull(x.category, nc, what),
    };
  };
  let budget: MonthFile["budget"] = null;
  if (o.budget !== null) {
    if (!isObj(o.budget)) fail("budget");
    const b = o.budget as Record<string, unknown>;
    const items = arr(b.items, "lignes du budget").map((i, k) => {
      const top = line(i, `ligne ${k + 1} du budget`);
      const children = arr((i as Record<string, unknown>).children, `ligne ${k + 1} du budget`).map((c, j) => line(c, `sous-ligne ${j + 1} de la ligne ${k + 1}`, top.kind));
      if (children.some((c) => c.reserve)) fail(`ligne ${k + 1} du budget (réserve en sous-ligne)`);
      return { ...top, children };
    });
    if (items.filter((i) => i.reserve).length > 1) fail("plusieurs réserves");
    budget = { status: oneOf(b.status, ["DRAFT", "VALIDATED"] as const, "statut du budget"), items };
  }
  const paid = new Set<number>();
  const transactions = arr(o.transactions, "opérations").map((t, k) => {
    if (!isObj(t)) fail(`opération ${k + 1}`);
    const what = `opération ${k + 1}`;
    const day = typeof t.occurredOn === "string" ? parseDay(t.occurredOn) : null;
    if (!day || day < month! || day >= next) fail(`${what} (date hors du mois)`);
    const payment = refOrNull(t.payment, charges.length, what);
    if (payment !== null && (paid.has(payment) || !paid.add(payment))) fail(`${what} (charge déjà réglée ce mois)`);
    let prepayment: MonthFile["transactions"][number]["prepayment"] = null;
    if (t.prepayment !== null) {
      if (!isObj(t.prepayment)) fail(what);
      const p = t.prepayment as Record<string, unknown>;
      const charge = ref(p.charge, charges.length, what);
      if (!charges[charge].loan) fail(`${what} (crédit absent)`);
      prepayment = { charge, mode: oneOf(p.mode, ["REDUCE_TERM", "REDUCE_PAYMENT"] as const, what) };
    }
    return {
      kind: oneOf(t.kind, KINDS, what), amount: int(t.amount, what, 1), occurredOn: t.occurredOn as string,
      note: t.note === null ? null : typeof t.note === "string" ? t.note.slice(0, 500) : fail(what),
      category: refOrNull(t.category, nc, what), shared: bool(t.shared, what),
      paidBy: ref(t.paidBy, members.length, what), createdBy: ref(t.createdBy, members.length, what), payment, prepayment,
    };
  });
  return { version: 1, month: o.month as string, members, categories, charges, budget, transactions };
}

// --- Import ---

const ci = (name: string) => ({ equals: name, mode: "insensitive" as const });

/**
 * Rend le mois du foyer identique au fichier : budget (lignes et statut ; supprimé s'il n'y en a pas dans le fichier),
 * opérations du mois, paiements de charges et remboursements anticipés. Le tout en une transaction SQL.
 * Membres retrouvés par e-mail puis par nom (jamais créés). Catégories, charges et crédits retrouvés par nom
 * (créés à défaut) et mis aux valeurs du fichier : groupe fixe / épargne des catégories, réglages des charges, conditions des crédits.
 */
export async function importMonth(householdId: string, file: MonthFile) {
  const month = parseMonth(file.month)!;
  await prisma.$transaction(async (tx) => {
    const users = await tx.user.findMany({ where: { householdId }, select: { id: true, email: true, name: true } });
    const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
    const members = file.members.map((m) => {
      const u = users.find((u) => same(u.email, m.email)) ?? users.find((u) => same(u.name, m.name));
      return u ? u.id : fail(`membre « ${m.name} » (${m.email}) introuvable : créez-le dans Membres puis importez à nouveau`);
    });

    const cats: string[] = [];
    for (const c of file.categories) {
      const parentId = c.parent === null ? null : cats[c.parent];
      const flags = parentId ? {} : { fixed: c.fixed, savings: c.savings }; // les sous-catégories suivent leur parent
      const found = await tx.category.findFirst({ where: { householdId, kind: c.kind, parentId, name: ci(c.name) }, select: { id: true } });
      cats.push(found
        ? (await tx.category.update({ where: { id: found.id }, data: flags, select: { id: true } })).id
        : (await tx.category.create({ data: { householdId, kind: c.kind, name: c.name, parentId, isTemplate: false, ...flags }, select: { id: true } })).id);
    }
    const catId = (r: Ref | null) => (r === null ? null : cats[r]);

    const charges: string[] = [], loans: (string | null)[] = [];
    for (const { kind: _, loan, category, startMonth, endMonth, ...c } of file.charges) {
      const data = { ...c, categoryId: cats[category], startMonth: parseMonth(startMonth)!, endMonth: endMonth ? parseMonth(endMonth) : null };
      const found = await tx.fixedCharge.findFirst({ where: { householdId, name: ci(c.name) }, select: { id: true } });
      const id = found ? (await tx.fixedCharge.update({ where: { id: found.id }, data })).id : (await tx.fixedCharge.create({ data: { ...data, householdId } })).id;
      charges.push(id);
      loans.push(loan ? (await tx.loan.upsert({ where: { fixedChargeId: id }, create: { ...loan, householdId, fixedChargeId: id }, update: loan })).id : null);
    }

    // Opérations du mois : leur suppression emporte paiements de charges et remboursements anticipés liés.
    await tx.transaction.deleteMany({ where: { householdId, occurredOn: { gte: month, lt: addMonths(month, 1) } } });
    await tx.fixedChargePayment.deleteMany({ where: { householdId, month } });

    if (!file.budget) await tx.budget.deleteMany({ where: { householdId, month } });
    else {
      const budget = await tx.budget.upsert({ where: { householdId_month: { householdId, month } }, create: { householdId, month }, update: {} });
      await lockBudget(tx, householdId, budget.id, false);
      await tx.budgetItem.deleteMany({ where: { budgetId: budget.id } });
      for (const { children, category, ...top } of file.budget.items) {
        const parent = await tx.budgetItem.create({ data: { ...top, categoryId: catId(category), householdId, budgetId: budget.id } });
        if (children.length) {
          await tx.budgetItem.createMany({
            data: children.map(({ category: c, ...child }) => ({ ...child, categoryId: catId(c), householdId, budgetId: budget.id, parentId: parent.id })),
          });
        }
      }
      await tx.budget.update({ where: { id: budget.id }, data: { status: file.budget.status } });
    }

    for (const t of file.transactions) {
      const { id } = await tx.transaction.create({
        data: {
          householdId, kind: t.kind, amount: t.amount, occurredOn: parseDay(t.occurredOn)!, note: t.note, categoryId: catId(t.category), shared: t.shared,
          paidById: members[t.paidBy], createdById: members[t.createdBy],
        },
      });
      if (t.payment !== null) await tx.fixedChargePayment.create({ data: { householdId, fixedChargeId: charges[t.payment], month, transactionId: id } });
      if (t.prepayment) await tx.loanPrepayment.create({ data: { householdId, loanId: loans[t.prepayment.charge]!, transactionId: id, mode: t.prepayment.mode } });
    }
    // Mêmes règles qu'à la saisie (prepay) : chaque anticipé importé s'applique en entier.
    for (const l of new Set(file.transactions.flatMap((t) => (t.prepayment ? [loans[t.prepayment.charge]!] : [])))) await checkPrepayments(tx, householdId, l);
  }, { timeout: 30_000 });
}
