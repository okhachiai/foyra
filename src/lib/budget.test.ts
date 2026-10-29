import { beforeEach, describe, expect, it } from "vitest";
import { fullScope } from "./access";
import { setupHousehold } from "./auth";
import {
  addItem, budgetSeeds, budgetTotals, buildTree, envelopes, incomeLines, mergeIncomes, carryOver, createBudget, fromTemplates, getBudget, moveItem, parseMonth, removeItem, saveItems, setBudgetStatus, type Item,
} from "./budget";
import { updateCategory } from "./categories";
import { prisma } from "./db";
import { accountBalance, createEntry, LedgerError, NotFoundError, parseDay } from "./ledger";

// --- Calculs purs ---

let n = 0;
const item = (o: Partial<Item>): Item => ({
  id: `i${++n}`, parentId: null, categoryId: null, kind: "EXPENSE", label: `L${n}`, amount: 0, included: true, recurring: true, sortOrder: n, shared: true, reserve: false, ...o,
});

describe("totaux du budget (sans double comptage)", () => {
  const salaire = item({ id: "sal", kind: "INCOME", amount: 250000 });
  const factures = item({ id: "fac", amount: 99999, category: { fixed: true } }); // montant direct parasite : jamais compté
  const elec = item({ parentId: "fac", amount: 8000 });
  const eau = item({ parentId: "fac", amount: 3000 });
  const divers = item({ id: "div", amount: 5000 });

  it("Parent avec enfants = somme des enfants inclus ; sans enfants = son propre montant", () => {
    const [fac] = buildTree([factures, elec, eau]);
    expect(fac.total).toBe(11000);
    expect(budgetTotals([salaire, factures, elec, eau, divers])).toEqual({ income: 250000, expense: 16000, fixed: 11000, variable: 5000, remaining: 234000 });
  });

  it("Exclure une sous-ligne la retire du total de son parent", () => {
    expect(budgetTotals([factures, elec, { ...eau, included: false }, divers]).expense).toBe(13000);
  });

  it("Exclure une ligne principale exclut toute sa branche", () => {
    expect(budgetTotals([salaire, { ...factures, included: false }, elec, eau, divers])).toEqual({ income: 250000, expense: 5000, fixed: 0, variable: 5000, remaining: 245000 });
    expect(budgetTotals([{ ...salaire, included: false }]).income).toBe(0);
  });

  it("Reste négatif possible", () => {
    expect(budgetTotals([item({ kind: "INCOME", amount: 100 }), item({ amount: 250 })]).remaining).toBe(-150);
  });
});

describe("enveloppes (pures)", () => {
  const env = (items: Item[], actual: Record<string, number>) => envelopes(buildTree(items).map((t) => ({ ...t, actual: actual[t.id] ?? 0 })));

  it("enveloppes : dépassement absorbé par la réserve", () => {
    const { lines, reserve } = env([
      item({ id: "c", label: "Courses", amount: 30000 }),
      item({ id: "s", label: "Sorties", amount: 0 }),
      item({ id: "r", label: "Réserve imprévus", amount: 8856, reserve: true }),
    ], { c: 25000, s: 5000 });
    expect(lines).toEqual([
      { id: "c", label: "Courses", planned: 30000, actual: 25000, left: 5000 },
      { id: "s", label: "Sorties", planned: 0, actual: 5000, left: -5000 },
    ]);
    expect(reserve).toEqual({ id: "r", label: "Réserve imprévus", planned: 8856, actual: 0, left: 3856, overrun: 5000 });
  });

  it("enveloppes : lignes perso, fixes et exclues ignorées", () => {
    const { lines, reserve } = env([
      item({ id: "c", amount: 1000 }),
      item({ id: "p", amount: 1000, shared: false }),
      item({ id: "f", amount: 1000, category: { fixed: true } }),
      item({ id: "x", amount: 1000, included: false }),
      item({ id: "i", amount: 1000, kind: "INCOME", reserve: true }),
      item({ id: "xr", amount: 1000, included: false, reserve: true }),
    ], { p: 9000, f: 9000, x: 9000, i: 9000 });
    expect(lines.map((l) => l.id)).toEqual(["c"]);
    expect(reserve).toBeNull(); // réserve sur un revenu ou une ligne exclue : ignorée
  });
});

describe("reprise et modèles (purs)", () => {
  it("reprise : shared et reserve recopiés", () => {
    const [perso, res] = carryOver([item({ label: "Perso", shared: false }), item({ label: "Réserve", reserve: true })]);
    expect(perso).toMatchObject({ shared: false, reserve: false });
    expect(res).toMatchObject({ shared: true, reserve: true });
  });

  it("Reprise : seules les lignes récurrentes, structure et valeurs conservées, sans identifiant", () => {
    const loyer = item({ id: "loy", label: "Loyer", amount: 95000 });
    const fac = item({ id: "f", label: "Factures", recurring: false, amount: 0 });
    const elec = item({ parentId: "f", label: "Électricité", amount: 8000 });
    const cadeau = item({ parentId: "f", label: "Cadeau", recurring: false, amount: 3000 });
    const vacances = item({ label: "Vacances", recurring: false, amount: 50000 });
    const seeds = carryOver([loyer, fac, elec, cadeau, vacances]);
    expect(seeds.map((s) => s.label)).toEqual(["Loyer", "Factures"]); // parent ramené par son enfant récurrent
    expect(seeds[0]).toMatchObject({ amount: 95000, children: [] });
    expect(seeds[1].children).toEqual([expect.objectContaining({ label: "Électricité", amount: 8000 })]);
    expect(JSON.stringify(seeds)).not.toMatch(/"id"|"parentId"/);
  });

  it("Modèles : catégories actives marquées modèle ; parent avec enfants à 0", () => {
    const c = (o: object) => ({ id: "x", kind: "EXPENSE" as const, name: "X", forecastAmount: 0, enabled: true, recurring: true, isTemplate: true, sortOrder: 0, archivedAt: null, ...o });
    const seeds = fromTemplates([
      { ...c({ id: "a", name: "Logement", forecastAmount: 777 }), children: [c({ id: "a1", name: "Loyer", forecastAmount: 90000 }), c({ id: "a2", name: "Old", archivedAt: new Date() })] },
      { ...c({ id: "b", name: "Hors modèle", isTemplate: false }), children: [] },
      { ...c({ id: "d", name: "Divers", forecastAmount: 1000, enabled: false }), children: [] },
    ]);
    expect(seeds.map((s) => [s.label, s.amount, s.included, s.children.map((k) => k.label)])).toEqual([
      ["Logement", 0, true, ["Loyer"]],
      ["Divers", 1000, false, []],
    ]);
  });
});

// --- Base de données ---

let hh: string;
let user: string;
const oct = parseMonth("2026-10")!;
const nov = parseMonth("2026-11")!;
const items = (budgetId: string) => prisma.budgetItem.findMany({ where: { budgetId } });
const find = async (budgetId: string, label: string) => (await items(budgetId)).find((i) => i.label === label)!;
const fields = (i: Item, o: Partial<Item> = {}) => ({ label: i.label, amount: i.amount, included: i.included, recurring: i.recurring, ...o });

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`TRUNCATE "Transaction", "Category", "Account", "Session", "User", "Household" CASCADE`);
  const admin = (await setupHousehold({ householdName: "Test", name: "Admin", email: "a@test.fr", password: "password1" }))!;
  hh = admin.householdId;
  user = admin.id;
});

describe("revenus proposés à la création", () => {
  it("Revenus fixes en tête ; même libellé ou ligne à 0 de même catégorie retirés ; autres conservés", () => {
    const proposed = [
      { label: "salaire", amount: 200000, categoryId: "sal" }, // repris du mois précédent
      { label: "Salaires", amount: 0, categoryId: "sal" }, // modèle vide
      { label: "Allocations", amount: 0, categoryId: "sal" }, // même catégorie mais montant 0 → retiré aussi
      { label: "Loyer perçu", amount: 50000, categoryId: "loc" },
    ];
    expect(mergeIncomes(proposed, [{ name: "Salaire", amount: 250000, categoryId: "sal" }])).toEqual([
      { label: "Salaire", amount: 250000, categoryId: "sal" },
      { label: "Loyer perçu", amount: 50000, categoryId: "loc" },
    ]);
    expect(mergeIncomes(proposed, [])).toEqual(proposed);
  });
});

describe("budget mensuel", () => {
  it("Jamais créé implicitement ; création explicite depuis les modèles (aucun budget antérieur), montants à 0", async () => {
    expect(await getBudget(fullScope(hh), nov)).toBeNull();
    const b = await createBudget(hh, nov);
    const got = (await getBudget(fullScope(hh), nov))!;
    expect(got).toMatchObject({ id: b.id, status: "DRAFT", totals: { income: 0, expense: 0, remaining: 0 } });
    expect(got.tree.find((t) => t.label === "Factures")!.children.map((c) => c.label)).toEqual(["Électricité", "Gaz", "Eau", "Internet", "Téléphones"]);
  });

  it("Revenus saisis à la création : remplacent les revenus proposés ; catégorie hors foyer ignorée", async () => {
    const proposed = incomeLines(await budgetSeeds(prisma, hh, nov));
    expect(proposed.length).toBeGreaterThan(0);
    const b = await createBudget(hh, nov, [{ label: "Salaire", amount: 250000, categoryId: proposed[0].categoryId }, { label: "Prime", amount: 30000, categoryId: "étranger" }]);
    const inc = (await items(b.id)).filter((i) => i.kind === "INCOME").sort((x, y) => x.sortOrder - y.sortOrder);
    expect(inc.map((i) => [i.label, i.amount, i.categoryId])).toEqual([["Salaire", 250000, proposed[0].categoryId], ["Prime", 30000, null]]);
    expect((await getBudget(fullScope(hh), nov))!.totals.income).toBe(280000);
  });

  it("Un seul budget par mois : créations simultanées → un budget ; doublon refusé en base", async () => {
    const [a, b] = await Promise.all([createBudget(hh, nov), createBudget(hh, nov)]);
    expect(a.id).toBe(b.id);
    expect(await prisma.budget.count()).toBe(1);
    await expect(prisma.budget.create({ data: { householdId: hh, month: nov } })).rejects.toThrow();
  });

  it("Reprise du précédent : lignes récurrentes et leurs valeurs, nouveaux identifiants ; non récurrentes absentes", async () => {
    const o = await createBudget(hh, oct);
    const loyer = await find(o.id, "Loyer");
    const marche = await find(o.id, "Marché");
    await saveItems(hh, o.id, new Map([[loyer.id, fields(loyer, { amount: 95000 })], [marche.id, fields(marche, { amount: 20000, recurring: false })]]));
    await addItem(hh, o.id, { kind: "EXPENSE", parentId: null, label: "Vacances", amount: 50000, included: true, recurring: false });

    const nv = await createBudget(hh, nov);
    const next = await items(nv.id);
    expect(next.find((i) => i.label === "Loyer")!.amount).toBe(95000);
    expect(next.some((i) => i.label === "Marché" || i.label === "Vacances")).toBe(false);
    const before = new Set((await items(o.id)).map((i) => i.id));
    expect(next.some((i) => before.has(i.id))).toBe(false);
    // Structure : Loyer reste sous Logement.
    const logement = next.find((i) => i.label === "Logement")!;
    expect(next.find((i) => i.label === "Loyer")!.parentId).toBe(logement.id);
  });

  it("Historique indépendant : modifier novembre ou le catalogue ne change pas octobre", async () => {
    const o = await createBudget(hh, oct);
    const octLoyer = await find(o.id, "Loyer");
    await saveItems(hh, o.id, new Map([[octLoyer.id, fields(octLoyer, { amount: 90000 })]]));
    const nv = await createBudget(hh, nov);
    const novLoyer = await find(nv.id, "Loyer");
    await saveItems(hh, nv.id, new Map([[novLoyer.id, fields(novLoyer, { amount: 99000, label: "Loyer révisé" })]]));
    await updateCategory(hh, octLoyer.categoryId!, { name: "Loyer renommé", forecastAmount: 123400, enabled: false, recurring: false, isTemplate: true, sortOrder: 1 });
    expect(await prisma.budgetItem.findUniqueOrThrow({ where: { id: octLoyer.id } })).toMatchObject({ label: "Loyer", amount: 90000, included: true });
    expect(await prisma.budgetItem.findUniqueOrThrow({ where: { id: novLoyer.id } })).toMatchObject({ label: "Loyer révisé", amount: 99000 });
  });

  it("Réglage « modèles » : ignore le budget précédent et reprend les montants par défaut", async () => {
    const o = await createBudget(hh, oct);
    const loyer = await find(o.id, "Loyer");
    await saveItems(hh, o.id, new Map([[loyer.id, fields(loyer, { amount: 95000 })]]));
    await prisma.category.updateMany({ where: { name: "Loyer" }, data: { forecastAmount: 80000 } });
    await prisma.household.update({ where: { id: hh }, data: { budgetSource: "TEMPLATES" } });
    expect((await find((await createBudget(hh, nov)).id, "Loyer")).amount).toBe(80000);
  });

  it("Sous-ligne : type du parent, montant direct du parent remis à 0 ; pas de 3e niveau (application et SQL)", async () => {
    const b = await createBudget(hh, nov);
    const divers = await find(b.id, "Divers et imprévus");
    await saveItems(hh, b.id, new Map([[divers.id, fields(divers, { amount: 7000 })]]));
    const sub = await addItem(hh, b.id, { kind: "INCOME", parentId: divers.id, label: "Cadeaux", amount: 2500, included: true, recurring: true });
    expect(sub.kind).toBe("EXPENSE");
    expect((await prisma.budgetItem.findUniqueOrThrow({ where: { id: divers.id } })).amount).toBe(0);
    // Montant d'un parent : ignoré à l'enregistrement (total calculé).
    await saveItems(hh, b.id, new Map([[divers.id, fields(divers, { amount: 4000 })]]));
    expect((await getBudget(fullScope(hh), nov))!.tree.find((t) => t.id === divers.id)!.total).toBe(2500);
    await expect(addItem(hh, b.id, { kind: "EXPENSE", parentId: sub.id, label: "Trop profond", amount: 0, included: true, recurring: true }))
      .rejects.toMatchObject({ field: "parentId" });
    await expect(prisma.budgetItem.create({ data: { householdId: hh, budgetId: b.id, parentId: sub.id, kind: "EXPENSE", label: "SQL" } })).rejects.toThrow();
    await expect(prisma.budgetItem.create({ data: { householdId: hh, budgetId: b.id, parentId: divers.id, kind: "INCOME", label: "Sens" } })).rejects.toThrow();
    await expect(prisma.budgetItem.updateMany({ where: { id: sub.id }, data: { amount: -1 } })).rejects.toThrow();
  });

  it("Ajout en dernier ; ↑/↓ échange avec la voisine, sans dépasser les bords", async () => {
    const b = await createBudget(hh, nov);
    const divers = await find(b.id, "Divers et imprévus");
    for (const label of ["A", "B", "C"]) await addItem(hh, b.id, { kind: "EXPENSE", parentId: divers.id, label, amount: 0, included: true, recurring: true });
    const order = async () => (await getBudget(fullScope(hh), nov))!.tree.find((t) => t.id === divers.id)!.children.map((c) => c.label);
    expect(await order()).toEqual(["A", "B", "C"]);
    const c = await find(b.id, "C");
    await moveItem(hh, b.id, c.id, "up");
    expect(await order()).toEqual(["A", "C", "B"]);
    await moveItem(hh, b.id, c.id, "up");
    await moveItem(hh, b.id, c.id, "up");
    expect(await order()).toEqual(["C", "A", "B"]);
    await moveItem(hh, b.id, c.id, "down");
    expect(await order()).toEqual(["A", "C", "B"]);
  });

  it("↑/↓ d'une ligne principale de dépense reste dans son groupe (charges fixes / variables)", async () => {
    const b = await createBudget(hh, nov);
    const group = async (fixed: boolean) =>
      (await getBudget(fullScope(hh), nov))!.tree.filter((t) => t.kind === "EXPENSE" && !!t.category?.fixed === fixed).map((t) => t.label);
    const [first, second] = await group(false);
    const ecole = await find(b.id, first);
    await moveItem(hh, b.id, ecole.id, "up"); // déjà en tête des variables : rien ne bouge
    expect((await group(false)).slice(0, 2)).toEqual([first, second]);
    await moveItem(hh, b.id, ecole.id, "down");
    expect((await group(false)).slice(0, 2)).toEqual([second, first]);
    expect(await group(true)).toEqual(["Logement", "Crédits", "Assurances", "Factures", "Abonnements", "Famille au Maroc"]);
  });

  it("Retirer une ligne principale retire sa branche", async () => {
    const b = await createBudget(hh, nov);
    const factures = await find(b.id, "Factures");
    await removeItem(hh, b.id, factures.id);
    expect((await items(b.id)).some((i) => i.label === "Électricité")).toBe(false);
  });

  it("Validé : lignes figées ; retour en brouillon : modifiables", async () => {
    const b = await createBudget(hh, nov);
    const loyer = await find(b.id, "Loyer");
    await setBudgetStatus(hh, b.id, "VALIDATED");
    await expect(saveItems(hh, b.id, new Map([[loyer.id, fields(loyer, { amount: 1 })]]))).rejects.toBeInstanceOf(LedgerError);
    await expect(removeItem(hh, b.id, loyer.id)).rejects.toBeInstanceOf(LedgerError);
    await setBudgetStatus(hh, b.id, "DRAFT");
    await saveItems(hh, b.id, new Map([[loyer.id, fields(loyer, { amount: 1 })]]));
    expect((await find(b.id, "Loyer")).amount).toBe(1);
  });

  it("Le budget ne crée aucune opération et ne touche aucun solde ; le réel vient des opérations", async () => {
    const acc = (await prisma.account.create({ data: { householdId: hh, name: "Courant", kind: "CHECKING", initialBalance: 10000 } })).id;
    const b = await createBudget(hh, nov);
    const marche = await find(b.id, "Marché");
    await saveItems(hh, b.id, new Map([[marche.id, fields(marche, { amount: 40000 })]]));
    await setBudgetStatus(hh, b.id, "VALIDATED");
    expect(await prisma.transaction.count()).toBe(0);
    expect(await accountBalance(fullScope(hh), acc)).toBe(10000);
    await createEntry(fullScope(hh), user, { accountId: acc, kind: "EXPENSE", amount: 1250, occurredOn: parseDay("2026-11-03")!, note: null, categoryId: marche.categoryId });
    const tree = (await getBudget(fullScope(hh), nov))!.tree;
    const alimentation = tree.find((t) => t.label === "Alimentation")!;
    expect(alimentation.children.find((c) => c.label === "Marché")!.actual).toBe(1250);
    expect(alimentation.actual).toBe(1250);
  });

  it("réel : courses perso ne débordent pas l'enveloppe commune ; revenu perso compté sur la ligne de revenu", async () => {
    const common = (await prisma.account.create({ data: { householdId: hh, name: "Joint", kind: "CHECKING" } })).id;
    const perso = (await prisma.account.create({ data: { householdId: hh, name: "Perso", kind: "CHECKING", ownerId: user } })).id;
    const incomeCat = (await prisma.category.findFirst({ where: { householdId: hh, kind: "INCOME" } }))!.id;
    const b = await createBudget(hh, nov, [{ label: "Salaire", amount: 250000, categoryId: incomeCat }]);
    const marche = await find(b.id, "Marché");
    const day = parseDay("2026-11-03")!;
    const entry = (accountId: string, kind: "INCOME" | "EXPENSE", amount: number, categoryId: string | null) =>
      createEntry(fullScope(hh), user, { accountId, kind, amount, occurredOn: day, note: null, categoryId });
    await entry(common, "EXPENSE", 1000, marche.categoryId);
    await entry(perso, "EXPENSE", 500, marche.categoryId); // personnelle par défaut
    await entry(perso, "INCOME", 200000, incomeCat);
    await entry(common, "INCOME", 3000, incomeCat);
    const tree = (await getBudget(fullScope(hh), nov))!.tree;
    const alimentation = tree.find((t) => t.label === "Alimentation")!;
    expect(alimentation.children.find((c) => c.label === "Marché")!.actual).toBe(1000);
    expect(alimentation.actual).toBe(1000);
    expect(tree.find((t) => t.label === "Salaire")!.actual).toBe(203000);
    // Ligne personnelle : seules les dépenses personnelles.
    await saveItems(hh, b.id, new Map([[alimentation.id, { ...fields(alimentation), shared: false }]]));
    expect((await getBudget(fullScope(hh), nov))!.tree.find((t) => t.id === alimentation.id)!.actual).toBe(500);
  });

  it("Réserve unique par budget ; sous-lignes alignées sur le parent (commun, jamais réserve)", async () => {
    const b = await createBudget(hh, nov);
    const divers = await find(b.id, "Divers et imprévus");
    const factures = await find(b.id, "Factures");
    const cadeaux = { kind: "EXPENSE" as const, parentId: divers.id, label: "Cadeaux", amount: 0, included: true, recurring: true, shared: false };
    await expect(addItem(hh, b.id, { ...cadeaux, reserve: true })).rejects.toThrow("La réserve doit être une ligne principale de dépense.");
    await expect(addItem(hh, b.id, { ...cadeaux, parentId: null, kind: "INCOME", reserve: true })).rejects.toThrow("La réserve doit être une ligne principale de dépense.");
    const sub = await addItem(hh, b.id, cadeaux);
    expect(sub).toMatchObject({ shared: true, reserve: false });
    await expect(saveItems(hh, b.id, new Map([[sub.id, { ...fields(divers), reserve: true }]]))).rejects.toThrow("La réserve doit être une ligne principale de dépense.");
    const salaire = await prisma.budgetItem.create({ data: { householdId: hh, budgetId: b.id, kind: "INCOME", label: "Salaire", sortOrder: 99 } });
    await expect(saveItems(hh, b.id, new Map([[salaire.id, { label: "Salaire", amount: 0, included: true, recurring: true, reserve: true }]]))).rejects.toThrow("La réserve doit être une ligne principale de dépense.");
    await saveItems(hh, b.id, new Map([[divers.id, { ...fields(divers), shared: false, reserve: true }], [sub.id, { ...fields(divers), shared: true }]]));
    expect(await prisma.budgetItem.findUniqueOrThrow({ where: { id: divers.id } })).toMatchObject({ shared: false, reserve: true });
    expect(await prisma.budgetItem.findUniqueOrThrow({ where: { id: sub.id } })).toMatchObject({ shared: false, reserve: false });
    await expect(saveItems(hh, b.id, new Map([[factures.id, { ...fields(factures), reserve: true }]]))).rejects.toThrow("Une seule réserve par budget.");
    // Déplacer la réserve d'une ligne à l'autre en un seul enregistrement.
    await saveItems(hh, b.id, new Map([[factures.id, { ...fields(factures), reserve: true }], [divers.id, { ...fields(divers), reserve: false }]]));
    expect((await find(b.id, "Factures")).reserve).toBe(true);
  });

  it("Isolation : un autre foyer ne lit ni ne modifie ce budget", async () => {
    const b = await createBudget(hh, nov);
    const loyer = await find(b.id, "Loyer");
    const other = (await setupHousehold({ householdName: "Autre", name: "B", email: "b@test.fr", password: "password1" }, { force: true }))!.householdId;
    expect(await getBudget(fullScope(other), nov)).toBeNull();
    await expect(saveItems(other, b.id, new Map([[loyer.id, fields(loyer, { amount: 1 })]]))).rejects.toBeInstanceOf(NotFoundError);
    await expect(removeItem(other, b.id, loyer.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(setBudgetStatus(other, b.id, "VALIDATED")).rejects.toBeInstanceOf(NotFoundError);
    await expect(addItem(other, b.id, { kind: "EXPENSE", parentId: null, label: "X", amount: 0, included: true, recurring: true })).rejects.toBeInstanceOf(NotFoundError);
    // Lignes d'un autre budget glissées dans la requête : ignorées.
    const ob = await createBudget(other, nov);
    await saveItems(other, ob.id, new Map([[loyer.id, fields(loyer, { amount: 1 })]]));
    expect((await find(b.id, "Loyer")).amount).toBe(0);
  });
});
