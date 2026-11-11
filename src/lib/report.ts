import { Prisma, type LlmProvider, type Report, type ReportKind, type ReportTrigger, type Role } from "@prisma/client";
import { addMonths } from "./amortization";
import { actualTotals, formatMonth, getBudget, groupOf, saveItems, type Group, type ItemFields } from "./budget";
import { listMonthCharges } from "./charges";
import { prisma } from "./db";
import { formatDay, isCode, LedgerError, NotFoundError } from "./ledger";
import { complete, LlmError, pickProvider, type LlmConfig } from "./llm";
import { DEFAULT_LOCALE, type Locale } from "./i18n";

type Kind = "INCOME" | "EXPENSE";
type Viewer = { id: string; role: Role; householdId: string };

/** Totaux par groupe (voir groupOf) et reste = revenus − fixes − variables − épargne. */
export type Totals = { income: number; fixed: number; savings: number; variable: number; remaining: number };
const totals = ({ income, fixed, savings, variable, remaining }: Totals): Totals => ({ income, fixed, savings, variable, remaining });

export type Pace = "ok" | "fast" | "over";

/**
 * Pace of an envelope on day `day` (1st = 1) of a `days`-day month: pro-rata expected spending, end-of-month projection,
 * amount per remaining day (today included). "fast": above expected by more than 10% of planned (avoids noise from small amounts).
 */
export function pace(planned: number, actual: number, day: number, days: number) {
  const expected = Math.round((planned * day) / days);
  const projected = Math.round((actual * days) / day);
  const perDay = Math.floor(Math.max(planned - actual, 0) / (days - day + 1));
  const status: Pace = actual > planned ? "over" : actual > expected + planned / 10 ? "fast" : "ok";
  return { expected, projected, perDay, status };
}

// --- Entrées (calculées par l'app, en centimes ; envoyées au LLM en euros) ---

/** Rapport du jour : enveloppes de charges variables du mois en cours et leur rythme. */
export type DailyInput = {
  today: string; day: number; daysInMonth: number;
  planned: Totals; actual: Totals;
  lines: ({ label: string; planned: number; actual: number } & ReturnType<typeof pace>)[];
  todayOps: { label: string; category: string | null; amount: number; kind: Kind; paidBy: string }[];
  uncategorized: { count: number; amount: number }; // dépenses du mois sans catégorie
  upcoming: { name: string; amount: number; due: string }[]; // charges fixes non payées à venir
};

/** Bilan d'un mois écoulé : prévu du budget contre réel ; `diff` = réel − prévu. */
export type MonthlyInput = {
  month: string; planned: Totals; actual: Totals;
  lines: { label: string; group: Group; planned: number; actual: number; diff: number }[];
  offBudget: number; // dépenses réelles non rattachées à une ligne du budget
};

/** Préparation du budget : reste à répartir sur les lignes de charges variables ; `history` = réel des 3 mois précédents, du plus ancien au plus récent. */
export type PlanInput = {
  month: string; income: number; fixed: number; savings: number; toDistribute: number;
  lines: { id: string; label: string; planned: number; history: number[]; reserve: boolean }[];
};

export type DailyOutput = { summary: string; alerts: string[]; advice: string[] };
export type MonthlyOutput = { verdict: string; respected: string[]; mistakes: string[]; advice: string[] };
export type PlanOutput = { lines: { budgetItemId: string; amount: number; reason: string }[]; advice: string };

type Input = DailyInput | MonthlyInput | PlanInput;
type Output = DailyOutput | MonthlyOutput | PlanOutput;

// --- Schémas et validation ---

type Schema = { type: string; items?: Schema; properties?: Record<string, Schema>; enum?: string[] };
const str = { type: "string" }, num = { type: "number" };
const arr = (items: Schema) => ({ type: "array", items });
const obj = (properties: Record<string, Schema>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });

/** JSON Schema de la sortie : tous champs requis, aucun en trop ; PLAN : ids restreints aux lignes reçues (un modèle local ne peut pas en inventer). */
export function outputSchema(kind: ReportKind, i?: Input) {
  if (kind === "DAILY") return obj({ summary: str, alerts: arr(str), advice: arr(str) });
  if (kind === "MONTHLY") return obj({ verdict: str, respected: arr(str), mistakes: arr(str), advice: arr(str) });
  const ids = (i as PlanInput | undefined)?.lines.map((l) => l.id);
  return obj({ lines: arr(obj({ budgetItemId: ids?.length ? { type: "string", enum: ids } : str, amount: num, reason: str })), advice: str });
}

/** Conformité au schéma. */
function conforms(v: unknown, s: Schema): boolean {
  if (s.type === "string") return typeof v === "string";
  if (s.type === "number") return typeof v === "number" && Number.isFinite(v);
  if (s.type === "array") return Array.isArray(v) && v.every((x) => conforms(x, s.items!));
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const keys = Object.keys(s.properties!);
  return Object.keys(v).every((k) => keys.includes(k)) && keys.every((k) => conforms((v as Record<string, unknown>)[k], s.properties![k]));
}

/**
 * Répartition PLAN : montants reçus en euros → centimes ; lignes omises à 0 ; somme ramenée pile sur `toDistribute`
 * (les petits modèles calculent mal) : surplus sur la réserve, sinon la plus grosse ligne ; excédent retiré de la réserve puis des plus grosses, jamais sous 0.
 */
function plan(i: PlanInput, o: PlanOutput): { output: PlanOutput } | { error: string } {
  const got = new Map<string, { amount: number; reason: string }>();
  for (const l of o.lines) {
    if (!i.lines.some((x) => x.id === l.budgetItemId)) return { error: `Unknown line: ${l.budgetItemId}.` };
    if (got.has(l.budgetItemId)) return { error: `Line allocated twice: ${l.budgetItemId}.` };
    if (l.amount < 0) return { error: `Negative amount for ${l.budgetItemId}: ${l.amount}.` };
    got.set(l.budgetItemId, { amount: Math.round(l.amount * 100), reason: l.reason });
  }
  const lines = i.lines.map((x) => ({ budgetItemId: x.id, amount: 0, reason: "", ...got.get(x.id) }));
  const reserve = i.lines.findIndex((x) => x.reserve);
  const order = lines.map((_, n) => n).sort((a, b) => (b === reserve ? Infinity : lines[b].amount) - (a === reserve ? Infinity : lines[a].amount));
  let diff = i.toDistribute - lines.reduce((s, l) => s + l.amount, 0);
  if (diff > 0) lines[order[0]].amount += diff;
  for (const n of order) {
    if (diff >= 0) break;
    const take = Math.min(-diff, lines[n].amount);
    (lines[n].amount -= take), (diff += take);
  }
  return { output: { lines, advice: o.advice } };
}

/** Valide la réponse du LLM contre l'entrée (pur). */
export function validateOutput(kind: ReportKind, input: Input, text: string): { ok: true; output: Output } | { ok: false; error: string } {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    // Modèle local : JSON entouré de ```json ou de prose ; on garde du premier « { » au dernier « } ».
    try {
      v = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    } catch {
      return { ok: false, error: "Response is not JSON." };
    }
  }
  if (!conforms(v, outputSchema(kind))) return { ok: false, error: "Response does not match the schema." };
  if (kind !== "PLAN") return { ok: true, output: v as Output };
  const r = plan(input as PlanInput, v as PlanOutput);
  return "error" in r ? { ok: false, error: r.error } : { ok: true, output: r.output };
}

// --- Construction des entrées ---

/** Rapport du jour `today` (Date UTC minuit, jour du foyer) sur le mois en cours. Aucun e-mail : seuls noms et libellés partent au LLM. */
async function dailyInput(householdId: string, today: Date) {
  const month = addMonths(today, 0);
  const [budget, actual, charges, ops, uncategorized] = await Promise.all([
    getBudget(householdId, month),
    actualTotals(householdId, month),
    listMonthCharges(householdId, month),
    prisma.transaction.findMany({
      where: { householdId, occurredOn: today },
      include: { paidBy: { select: { name: true } }, category: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.transaction.aggregate({
      where: { householdId, kind: "EXPENSE", categoryId: null, occurredOn: { gte: month, lt: addMonths(month, 1) } },
      _count: true, _sum: { amount: true },
    }),
  ]);
  if (!budget) throw new LedgerError("No budget for this month.");
  const day = today.getUTCDate();
  const daysInMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)).getUTCDate();
  const input: DailyInput = {
    today: formatDay(today), day, daysInMonth,
    planned: totals(budget.totals), actual: totals(actual),
    lines: budget.tree.filter((n) => n.included && groupOf(n) === "variable")
      .map((n) => ({ label: n.label, planned: n.total, actual: n.actual, ...pace(n.total, n.actual, day, daysInMonth) })),
    todayOps: ops.map((t) => ({ label: t.note ?? t.category?.name ?? "", category: t.category?.name ?? null, amount: t.amount, kind: t.kind, paidBy: t.paidBy.name })),
    uncategorized: { count: uncategorized._count, amount: uncategorized._sum.amount ?? 0 },
    upcoming: charges.filter((c) => !c.payment && c.due >= today).map((c) => ({ name: c.name, amount: c.amount, due: formatDay(c.due) })),
  };
  return { budgetId: budget.id, input };
}

const GROUPS: Group[] = ["income", "fixed", "savings", "variable"];

/** Bilan du mois `month` : lignes principales incluses par groupe, prévu contre réel. */
async function monthlyInput(householdId: string, month: Date) {
  const [budget, actual] = await Promise.all([getBudget(householdId, month), actualTotals(householdId, month)]);
  if (!budget) throw new LedgerError("No budget for this month.");
  const tracked = budget.tree.filter((n) => n.kind === "EXPENSE").reduce((s, n) => s + n.actual, 0);
  const input: MonthlyInput = {
    month: formatMonth(month), planned: totals(budget.totals), actual: totals(actual),
    lines: budget.tree.filter((n) => n.included).map((n) => ({ label: n.label, group: groupOf(n), planned: n.total, actual: n.actual, diff: n.actual - n.total }))
      .sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group)),
    offBudget: Math.max(actual.expense - tracked, 0),
  };
  return { budgetId: budget.id, input };
}

/** Préparation du budget `month` : reste à répartir et historique des lignes de charges variables (sous-lignes à la place de leur parent). */
async function planInput(householdId: string, month: Date) {
  const past = [-3, -2, -1].map((k) => addMonths(month, k));
  const [budget, ...sums] = await Promise.all([
    getBudget(householdId, month),
    ...past.map((m) => prisma.transaction.groupBy({
      by: ["categoryId", "shared"], where: { householdId, kind: "EXPENSE", occurredOn: { gte: m, lt: addMonths(m, 1) } }, _sum: { amount: true },
    })),
  ]);
  if (!budget) throw new LedgerError("No budget for this month.");
  if (budget.status === "VALIDATED") throw new LedgerError("This budget is validated: switch it back to draft to prepare it.");
  // Réel d'une ligne : comme getBudget, opérations de sa catégorie, communes ou personnelles selon la ligne.
  const spent = (categoryId: string | null, shared: boolean) =>
    sums.map((s) => (categoryId ? s.filter((r) => r.categoryId === categoryId && r.shared === shared).reduce((a, r) => a + (r._sum.amount ?? 0), 0) : 0));
  const lines = budget.tree.filter((n) => n.included && groupOf(n) === "variable").flatMap((n) =>
    n.children.length ? n.children.filter((c) => c.included).map((c) => ({ ...c, label: `${n.label} › ${c.label}` })) : [n],
  ).map((l) => ({ id: l.id, label: l.label, planned: l.amount, history: spent(l.categoryId, l.shared), reserve: l.reserve }));
  if (!lines.length) throw new LedgerError("No variable expense line in this budget.");
  const { income, fixed, savings } = budget.totals;
  const toDistribute = income - fixed - savings;
  if (toDistribute <= 0) throw new LedgerError("Nothing to allocate: planned income does not cover fixed charges and savings.");
  const input: PlanInput = { month: formatMonth(month), income, fixed, savings, toDistribute, lines };
  return { budgetId: budget.id, input };
}

// --- Consignes ---

const LANGUAGES: Record<Locale, string> = { en: "English", fr: "French", ar: "Arabic" };

const common = (locale: Locale) => `You are a household's budget advisor. You receive figures computed by the app, as JSON.
Amounts are in euros and exact: do not recompute or correct them. Answer in ${LANGUAGES[locale]}, with short, concrete sentences, in a direct and kind tone.
Quote the amounts and line names you receive; never invent a figure.`;

const PROMPTS: Record<ReportKind, string> = {
  DAILY: `Daily report (day "day" of "daysInMonth"). lines: variable expense envelopes; expected = expected spending to date, pro rata;
projected = end-of-month projection at the current pace; perDay = amount per day not to exceed until the end of the month;
status: ok, fast (above pace) or over (planned amount exceeded). planned / actual: the month's planned and actual totals.
- summary: 2 sentences: where the month stands and today's spending (todayOps).
- alerts: one sentence per management mistake found: envelope exceeded or too fast (with its projection), large expense today,
  uncategorized expenses (uncategorized), actual remainder insufficient for upcoming charges (upcoming). Empty list if all is well.
- advice: 1 to 3 concrete actions for the remaining days (e.g. do not exceed perDay per day on a given envelope).`,
  MONTHLY: `Review of the past month: budget planned on the 1st (planned) against actual (actual). lines: budget lines, group = income, fixed, savings or variable;
diff = actual − planned (positive expense: overspend; negative income: shortfall). offBudget: expenses not linked to a budget line.
- verdict: 2 to 3 sentences: was the budget kept, actual remainder vs planned, planned vs achieved savings.
- respected: the points that were kept.
- mistakes: each notable gap, most to least costly, with its amount.
- advice: 2 to 4 precise measures for next month so these mistakes are not repeated (e.g. plan a given amount on a given line).`,
  PLAN: `Preparing the month's budget: income = planned income, fixed = fixed charges, savings = desired savings;
toDistribute = income − fixed − savings, to be fully allocated across the variable expense lines (lines).
history = actual spending over the last 3 months on the line (oldest to newest; 0 = nothing spent or new line), planned = currently planned amount.
- lines: each line once, amount in whole euros and a short reason (based on history; keep a margin on the contingency reserve if reserve: true);
  the amounts must add up to toDistribute.
- advice: 2 to 3 sentences on the budget's balance (weight of fixed charges, savings, remaining margin).`,
};

/** Money keys of the input: cents → euros in the LLM request. */
const MONEY = new Set(["planned", "actual", "expected", "projected", "perDay", "amount", "income", "fixed", "savings", "variable", "remaining", "diff", "offBudget", "toDistribute", "history"]);
export const toEuros = (input: Input) =>
  JSON.stringify(input, (k, v) => (!MONEY.has(k) ? v : typeof v === "number" ? v / 100 : Array.isArray(v) ? v.map((x: number) => x / 100) : v));

/** Appel au LLM avec une nouvelle tentative si la sortie est refusée ; une erreur du fournisseur devient l'erreur du rapport. */
async function ask(provider: LlmProvider, config: LlmConfig, kind: ReportKind, input: Input, locale: Locale) {
  let model = "", retry: { previous: string; error: string } | undefined;
  for (let n = 0; n < 2; n++) {
    try {
      const r = await complete(provider, config, { system: `${common(locale)}\n${PROMPTS[kind]}`, user: toEuros(input), retry }, outputSchema(kind, input));
      model = r.model;
      const v = validateOutput(kind, input, r.text);
      if (v.ok) return { model, output: v.output, error: null };
      retry = { previous: r.text, error: v.error };
    } catch (e) {
      if (!(e instanceof LlmError)) throw e;
      return { model, output: null, error: e.message };
    }
  }
  return { model, output: null, error: retry!.error };
}

const auto = (householdId: string, day: Date, kind: ReportKind) => prisma.report.findFirst({ where: { householdId, day, kind, trigger: "AUTO" } });

/**
 * Génère et stocke un rapport le jour `today` (Date UTC minuit, jour du foyer) : DAILY sur le mois en cours, MONTHLY sur le mois écoulé,
 * PLAN sur `month` (requis). Fournisseur absent : préférence du foyer, sinon le premier configuré.
 * AUTO : sans auteur (visible de l'admin seul), un seul par foyer, jour et type — l'existant est renvoyé sans rappeler le LLM.
 * Sortie refusée deux fois ou fournisseur en échec : rapport stocké avec `error`. Sans budget du mois : LedgerError, rien n'est stocké.
 */
export async function generateReport(
  viewer: Viewer, kind: ReportKind, today: Date, trigger: ReportTrigger, opts: { provider?: LlmProvider; month?: Date; locale?: Locale } = {},
): Promise<Report> {
  const householdId = viewer.householdId;
  if (trigger === "AUTO") {
    const existing = await auto(householdId, today, kind);
    if (existing) return existing;
  }
  const config = await prisma.household.findUniqueOrThrow({ where: { id: householdId } });
  const provider = opts.provider ?? pickProvider(config);
  if (!provider) throw new LedgerError("No LLM provider configured.");
  const { budgetId, input } =
    kind === "DAILY" ? await dailyInput(householdId, today)
    : kind === "MONTHLY" ? await monthlyInput(householdId, addMonths(today, -1))
    : await planInput(householdId, opts.month ?? addMonths(today, 0));
  const { model, output, error } = await ask(provider, config, kind, input, opts.locale ?? DEFAULT_LOCALE);
  try {
    return await prisma.report.create({
      data: {
        householdId, budgetId, userId: trigger === "AUTO" ? null : viewer.id, day: today, kind, trigger, provider, model, error,
        input, output: output ?? Prisma.DbNull,
      },
    });
  } catch (e) {
    // Course entre deux AUTO : l'index partiel « Report_one_auto » garde le premier.
    if (trigger === "AUTO" && isCode(e, "P2002")) return (await auto(householdId, today, kind))!;
    throw e;
  }
}

/**
 * Rapports automatiques de chaque foyer ayant un admin actif et un fournisseur : quotidien, et le 1er du mois bilan du mois écoulé.
 * Renvoie le nombre de rapports créés.
 */
export async function generateAutoReports(today: Date): Promise<number> {
  const kinds: ReportKind[] = today.getUTCDate() === 1 ? ["MONTHLY", "DAILY"] : ["DAILY"];
  const households = await prisma.household.findMany({
    include: { users: { where: { role: "ADMIN", disabledAt: null }, orderBy: { createdAt: "asc" }, take: 1 } },
  });
  let created = 0;
  for (const h of households) {
    const provider = pickProvider(h);
    if (!h.users.length || !provider) continue;
    for (const kind of kinds) {
      if (await auto(h.id, today, kind)) continue;
      try {
        await generateReport(h.users[0], kind, today, "AUTO", { provider });
        created++;
      } catch (e) {
        // Pas de budget du mois : silencieux. Toute autre erreur est journalisée sans bloquer les autres foyers.
        if (!(e instanceof LedgerError)) console.error(`Automatic report: household ${h.id} failed:`, e instanceof Error ? e.message : e);
      }
    }
  }
  return created;
}

/** Rapports visibles : admin, tous ceux du foyer ; membre, les siens. Les 30 plus récents. */
export function listReports(viewer: Viewer): Promise<Report[]> {
  return prisma.report.findMany({
    where: { householdId: viewer.householdId, ...(viewer.role !== "ADMIN" && { userId: viewer.id }) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 30,
  });
}

/** Applique la répartition d'un rapport PLAN visible du viewer : prévu de chaque ligne = montant proposé ; lignes disparues ou devenues parents ignorées. */
export async function applyPlan(viewer: Viewer, reportId: string): Promise<number> {
  const r = await prisma.report.findFirst({
    where: { id: reportId, householdId: viewer.householdId, kind: "PLAN", ...(viewer.role !== "ADMIN" && { userId: viewer.id }) },
    include: { budget: { select: { month: true } } },
  });
  if (!r) throw new NotFoundError();
  if (!r.output) throw new LedgerError("This report has no proposal.");
  const budget = await getBudget(r.householdId, r.budget.month);
  const leaves = new Map(budget!.tree.flatMap((n) => (n.children.length ? n.children : [n])).map((n) => [n.id, n]));
  const items = new Map<string, ItemFields>();
  for (const l of (r.output as PlanOutput).lines) {
    const n = leaves.get(l.budgetItemId);
    if (n) items.set(n.id, { label: n.label, amount: l.amount, included: n.included, recurring: n.recurring });
  }
  await saveItems(r.householdId, r.budgetId, items);
  return items.size;
}
