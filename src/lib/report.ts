import { Prisma, type LlmProvider, type Report, type ReportTrigger, type Role } from "@prisma/client";
import { canRead, fullScope, getScope, readable } from "./access";
import { addMonths, envelopes, formatMonth, getBudget, saveItems, type Envelope, type ItemFields } from "./budget";
import { listMonthCharges } from "./charges";
import { prisma } from "./db";
import { ADJUSTMENT_NOTE, formatDay, getTransaction, isCode, LedgerError, listAccounts, NotFoundError, parseDay, updateEntry } from "./ledger";
import { complete, LlmError, pickProvider } from "./llm";
import { accountsByOwner, getSplit, visibleSplit, type Split } from "./split";

type Kind = "INCOME" | "EXPENSE";
type Viewer = { id: string; role: Role; householdId: string };

/** Opération transmise au LLM : libellé = note, sinon nom de catégorie. */
export type Op = { id: string; label: string; amount: number; kind: Kind; account: string; categoryId: string | null };

/** Tout ce que reçoit le LLM ; chaque montant est calculé par l'app (centimes). */
export type ReportInput = {
  today: string; daysLeft: number; month: string; split: Split;
  envelopes: (Envelope & { allocatable: boolean })[];
  reserve: (Envelope & { overrun: number; allocatable: boolean }) | null;
  available: number; // reste commun à répartir
  todayOps: Op[]; uncategorized: Op[];
  categories: { id: string; name: string; kind: Kind }[];
  upcoming: { name: string; amount: number; due: string; account: string }[];
  members: { id: string; name: string }[];
};

export type ReportOutput = {
  allocations: { budgetItemId: string; amount: number }[];
  categorize: { transactionId: string; categoryId: string }[];
  plan: { date: string; budgetItemId: string; label: string; amount: number }[];
  balancing: { fromUserId: string; toUserId: string; amount: number; reason: string }[];
  advice: string;
};

type Schema = { type: string; items?: Schema; properties?: Record<string, Schema> };
const str = { type: "string" }, int = { type: "integer" };
const arr = (items: Schema) => ({ type: "array", items });
const obj = (properties: Record<string, Schema>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });

/** JSON Schema de `ReportOutput` : tous champs requis, aucun champ en trop. */
export const OUTPUT_SCHEMA = obj({
  allocations: arr(obj({ budgetItemId: str, amount: int })),
  categorize: arr(obj({ transactionId: str, categoryId: str })),
  plan: arr(obj({ date: str, budgetItemId: str, label: str, amount: int })),
  balancing: arr(obj({ fromUserId: str, toUserId: str, amount: int, reason: str })),
  advice: str,
});

/** Conformité au schéma ; un nombre non entier passe ici pour être refusé ensuite avec l'id en cause. */
function conforms(v: unknown, s: Schema): boolean {
  if (s.type === "string") return typeof v === "string";
  if (s.type === "integer") return typeof v === "number";
  if (s.type === "array") return Array.isArray(v) && v.every((x) => conforms(x, s.items!));
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const keys = Object.keys(s.properties!);
  return Object.keys(v).every((k) => keys.includes(k)) && keys.every((k) => conforms((v as Record<string, unknown>)[k], s.properties![k]));
}

/** Première incohérence de la sortie, ou null. */
function check(i: ReportInput, o: ReportOutput): string | null {
  const allocatable = new Set([...i.envelopes, ...(i.reserve ? [i.reserve] : [])].filter((e) => e.allocatable).map((e) => e.id));
  const amounts: [string, number][] = [
    ...o.allocations.map((a) => [a.budgetItemId, a.amount] as [string, number]),
    ...o.plan.map((p) => [p.budgetItemId, p.amount] as [string, number]),
    ...o.balancing.map((b) => [b.fromUserId, b.amount] as [string, number]),
  ];
  for (const [id, n] of amounts) if (!Number.isInteger(n) || n < 0) return `Montant invalide pour ${id} : ${n} (entier ≥ 0 en centimes attendu).`;

  const allocated = new Map<string, number>();
  for (const a of o.allocations) {
    if (!allocatable.has(a.budgetItemId)) return `Ligne non allouable ou inconnue : ${a.budgetItemId}.`;
    if (allocated.has(a.budgetItemId)) return `Ligne allouée deux fois : ${a.budgetItemId}.`;
    allocated.set(a.budgetItemId, a.amount);
  }
  const total = o.allocations.reduce((s, a) => s + a.amount, 0);
  if (allocatable.size && total !== i.available) return `Somme des allocations ${total} ≠ reste commun disponible ${i.available} (centimes).`;

  const ops = new Map([...i.todayOps, ...i.uncategorized].map((t) => [t.id, t.kind]));
  const cats = new Map(i.categories.map((c) => [c.id, c.kind]));
  const categorized = new Set<string>();
  for (const c of o.categorize) {
    if (!ops.has(c.transactionId)) return `Opération inconnue : ${c.transactionId}.`;
    if (categorized.has(c.transactionId)) return `Opération catégorisée deux fois : ${c.transactionId}.`;
    categorized.add(c.transactionId);
    if (cats.get(c.categoryId) !== ops.get(c.transactionId)) return `Catégorie inconnue ou de mauvais sens pour ${c.transactionId} : ${c.categoryId}.`;
  }

  const planned = new Map<string, number>();
  for (const p of o.plan) {
    if (!allocatable.has(p.budgetItemId)) return `Ligne non allouable ou inconnue dans le plan : ${p.budgetItemId}.`;
    // Jours restants du mois, aujourd'hui compris.
    if (!parseDay(p.date) || p.date < i.today || !p.date.startsWith(`${i.month}-`)) return `Date hors du reste du mois : ${p.date}.`;
    planned.set(p.budgetItemId, (planned.get(p.budgetItemId) ?? 0) + p.amount);
  }
  for (const [id, sum] of planned) if (sum > (allocated.get(id) ?? 0)) return `Plan de ${id} (${sum}) supérieur à son allocation (${allocated.get(id) ?? 0}).`;

  const members = new Set(i.members.map((m) => m.id));
  for (const b of o.balancing) {
    for (const id of [b.fromUserId, b.toUserId]) if (!members.has(id)) return `Membre inconnu : ${id}.`;
    if (b.fromUserId === b.toUserId) return `Rééquilibrage d'un membre vers lui-même : ${b.fromUserId}.`;
  }
  return null;
}

/** Valide au centime la réponse du LLM contre l'entrée (pur). */
export function validateOutput(input: ReportInput, text: string): { ok: true; output: ReportOutput } | { ok: false; error: string } {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return { ok: false, error: "Réponse non JSON." };
  }
  if (!conforms(v, OUTPUT_SCHEMA)) return { ok: false, error: "Réponse non conforme au schéma." };
  const error = check(input, v as ReportOutput);
  return error ? { ok: false, error } : { ok: true, output: v as ReportOutput };
}

/**
 * Entrée du rapport du mois de `today` (Date UTC minuit, jour du foyer) vue par `viewer`.
 * Partage : agrégats seuls pour les membres dont il ne lit pas tous les comptes. Enveloppes et disponible : portée complète
 * (argent commun, identique pour tous). Opérations et échéances : comptes lisibles seulement ; ajustements de solde exclus.
 * Aucun e-mail ni identifiant de session : seuls ids, noms et libellés partent au LLM.
 */
export async function buildInput(viewer: Viewer, today: Date): Promise<{ budgetId: string; input: ReportInput }> {
  const householdId = viewer.householdId;
  const month = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const all = fullScope(householdId);
  const scope = await getScope(viewer);
  const [budget, split, accounts, charges, ops, categories] = await Promise.all([
    getBudget(all, month),
    getSplit(householdId, month),
    listAccounts(all),
    listMonthCharges(all, month),
    prisma.transaction.findMany({
      where: {
        householdId, accountId: readable(scope), kind: { in: ["INCOME", "EXPENSE"] }, occurredOn: { gte: month, lt: addMonths(month, 1) },
        OR: [{ occurredOn: today }, { categoryId: null }],
      },
      include: { account: { select: { name: true } }, category: { select: { name: true } } },
      orderBy: [{ occurredOn: "asc" }, { createdAt: "asc" }],
    }),
    prisma.category.findMany({ where: { householdId, archivedAt: null }, select: { id: true, name: true, kind: true }, orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { name: "asc" }] }),
  ]);
  if (!budget) throw new LedgerError("Aucun budget pour ce mois.");
  // Filtré ici : en SQL, NOT (… AND note = …) écarterait aussi les notes nulles.
  const kept = ops.filter((t) => !(t.categoryId === null && t.note === ADJUSTMENT_NOTE));

  // Allouable : ligne sans sous-ligne (le plan porte sur une ligne précise).
  const leaf = new Set(budget.tree.filter((n) => !n.children.length).map((n) => n.id));
  const { lines, reserve } = envelopes(budget.tree);
  const common = new Set(accounts.filter((a) => a.ownerId === null && !a.archivedAt).map((a) => a.id));
  const unpaid = charges.filter((c) => c.kind === "EXPENSE" && !c.payment);
  const available = Math.max(
    accounts.filter((a) => common.has(a.id)).reduce((s, a) => s + a.balance, 0) - unpaid.filter((c) => common.has(c.accountId)).reduce((s, c) => s + c.amount, 0),
    0,
  );
  const op = (t: (typeof ops)[number]): Op => ({
    id: t.id, label: t.note ?? t.category?.name ?? "", amount: t.amount, kind: t.kind as Kind, account: t.account.name, categoryId: t.categoryId,
  });
  const day = formatDay(today);
  // Jours restants, aujourd'hui compris (le 30 d'un mois de 30 jours : 1).
  const daysLeft = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)).getUTCDate() - today.getUTCDate() + 1;

  return {
    budgetId: budget.id,
    input: {
      today: day, daysLeft, month: formatMonth(month),
      split: visibleSplit(split, viewer, scope, accountsByOwner(accounts)),
      envelopes: lines.map((l) => ({ ...l, allocatable: leaf.has(l.id) })),
      reserve: reserve && { ...reserve, allocatable: leaf.has(reserve.id) },
      available,
      todayOps: kept.filter((t) => t.occurredOn.getTime() === today.getTime()).map(op),
      uncategorized: kept.filter((t) => t.categoryId === null).map(op),
      categories: categories.map((c) => ({ ...c, kind: c.kind as Kind })),
      // Dépenses prévues seulement : `upcoming` ne porte pas de sens.
      upcoming: unpaid.filter((c) => formatDay(c.due) >= day && canRead(scope, c.accountId))
        .map((c) => ({ name: c.name, amount: c.amount, due: formatDay(c.due), account: c.account.name })),
      members: split.members.map((m) => ({ id: m.userId, name: m.name })),
    },
  };
}

/** Consigne du LLM : il rédige et répartit, l'app a déjà fait tous les calculs. */
export const SYSTEM_PROMPT = `Tu es le conseiller budgétaire d'un foyer. Tu reçois en JSON la situation du mois, calculée par l'application.
Tous les montants sont en centimes d'euro et sont exacts : ne les recalcule pas, ne les corrige pas.
Rédige le rapport du jour, ton simple et bienveillant, en français :
- dépenses du jour (todayOps) et catégorie proposée pour chaque opération sans catégorie (categorize, catégorie de même sens) ;
- budget actualisé : répartis le reste commun disponible (available) entre les enveloppes allouables et la réserve imprévus (allocations) ;
  la somme des allocations doit être exactement égale à available ;
- planning des dépenses sur les jours restants du mois (plan), sans dépasser l'allocation de chaque ligne ;
- rééquilibrages éventuels entre membres (balancing) ;
- un conseil court et concret (advice).`;

/** Appel au LLM avec une nouvelle tentative si la sortie est refusée ; une erreur du fournisseur devient l'erreur du rapport. */
async function ask(provider: LlmProvider, input: ReportInput) {
  let model = "", retry: { previous: string; error: string } | undefined;
  for (let n = 0; n < 2; n++) {
    try {
      const r = await complete(provider, { system: SYSTEM_PROMPT, user: JSON.stringify(input), retry }, OUTPUT_SCHEMA);
      model = r.model;
      const v = validateOutput(input, r.text);
      if (v.ok) return { model, output: v.output, error: null };
      retry = { previous: r.text, error: v.error };
    } catch (e) {
      if (!(e instanceof LlmError)) throw e;
      return { model, output: null, error: e.message };
    }
  }
  return { model, output: null, error: retry!.error };
}

const daily = (householdId: string, day: Date) => prisma.report.findFirst({ where: { householdId, day, trigger: "DAILY" } });

/**
 * Génère et stocke le rapport du jour `today` (Date UTC minuit). Fournisseur absent : préférence du foyer, sinon le premier configuré.
 * DAILY : sans auteur (visible de l'admin seul), un seul par foyer et par jour — l'existant est renvoyé sans rappeler le LLM.
 * Sortie refusée deux fois ou fournisseur en échec : rapport stocké avec `error`. Sans budget du mois : LedgerError, rien n'est stocké.
 */
export async function generateReport(viewer: Viewer, today: Date, trigger: ReportTrigger, provider?: LlmProvider): Promise<Report> {
  const householdId = viewer.householdId;
  if (trigger === "DAILY") {
    const existing = await daily(householdId, today);
    if (existing) return existing;
  }
  provider ??= pickProvider((await prisma.household.findUniqueOrThrow({ where: { id: householdId } })).llmProvider) ?? undefined;
  if (!provider) throw new LedgerError("Aucun fournisseur LLM configuré.");
  const { budgetId, input } = await buildInput(viewer, today);
  const { model, output, error } = await ask(provider, input);
  try {
    return await prisma.report.create({
      data: {
        householdId, budgetId, userId: trigger === "DAILY" ? null : viewer.id, day: today, trigger, provider, model, error,
        input, output: output ?? Prisma.DbNull,
      },
    });
  } catch (e) {
    // Course entre deux DAILY : l'index partiel « Report_one_daily » garde le premier.
    if (trigger === "DAILY" && isCode(e, "P2002")) return (await daily(householdId, today))!;
    throw e;
  }
}

/** Rapport DAILY de chaque foyer ayant un admin actif, un fournisseur et un budget du mois ; renvoie le nombre de rapports créés. */
export async function generateDailyReports(today: Date): Promise<number> {
  const households = await prisma.household.findMany({
    select: { id: true, llmProvider: true, users: { where: { role: "ADMIN", disabledAt: null }, orderBy: { createdAt: "asc" }, take: 1 } },
  });
  let created = 0;
  for (const h of households) {
    const provider = pickProvider(h.llmProvider);
    if (!h.users.length || !provider || (await daily(h.id, today))) continue;
    try {
      await generateReport(h.users[0], today, "DAILY", provider);
      created++;
    } catch (e) {
      if (!(e instanceof LedgerError)) throw e; // pas de budget du mois
    }
  }
  return created;
}

/** Rapports visibles : admin, tous ceux du foyer ; membre, les siens. Les 30 plus récents. */
export function listReports(viewer: Viewer): Promise<Report[]> {
  return prisma.report.findMany({
    where: { householdId: viewer.householdId, ...(viewer.role !== "ADMIN" && { userId: viewer.id }) },
    orderBy: { createdAt: "desc" }, take: 30,
  });
}

/** Rapport visible du viewer (admin ou auteur) avec ses propositions ; sinon NotFoundError. */
async function proposal(viewer: Viewer, reportId: string) {
  const r = await prisma.report.findFirst({
    where: { id: reportId, householdId: viewer.householdId, ...(viewer.role !== "ADMIN" && { userId: viewer.id }) },
    include: { budget: { select: { month: true, status: true } } },
  });
  if (!r) throw new NotFoundError();
  if (!r.output) throw new LedgerError("Ce rapport n'a pas de proposition.");
  return { ...r, output: r.output as ReportOutput };
}

/** Applique la répartition : prévu de chaque ligne = réel actuel (relu maintenant) + allocation. Lignes disparues ou devenues parents ignorées. */
export async function applyAllocations(viewer: Viewer, reportId: string): Promise<number> {
  const r = await proposal(viewer, reportId);
  if (r.budget.status === "VALIDATED") throw new LedgerError("Repasser le budget en brouillon pour appliquer");
  const budget = await getBudget(fullScope(r.householdId), r.budget.month);
  const nodes = new Map(budget!.tree.filter((n) => !n.children.length).map((n) => [n.id, n]));
  const items = new Map<string, ItemFields>();
  for (const a of r.output.allocations) {
    const n = nodes.get(a.budgetItemId);
    if (n) items.set(n.id, { label: n.label, amount: n.actual + a.amount, included: n.included, recurring: n.recurring });
  }
  await saveItems(r.householdId, r.budgetId, items);
  return items.size;
}

/** Applique les catégories proposées sous la portée du viewer ; opérations disparues, illisibles ou non modifiables ignorées. */
export async function applyCategories(viewer: Viewer, reportId: string): Promise<number> {
  const r = await proposal(viewer, reportId);
  const scope = await getScope(viewer);
  let n = 0;
  for (const c of r.output.categorize) {
    try {
      const t = await getTransaction(scope, c.transactionId);
      if (t.kind === "TRANSFER" || t.categoryId === c.categoryId) continue;
      const { accountId, kind, amount, occurredOn, note, shared } = t;
      await updateEntry(scope, t.id, { accountId, kind, amount, occurredOn, note, shared, categoryId: c.categoryId });
      n++;
    } catch (e) {
      if (!(e instanceof LedgerError || e instanceof NotFoundError)) throw e;
    }
  }
  return n;
}
