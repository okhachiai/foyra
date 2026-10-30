"use server";

import { timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { AccessLevel, AccountKind, AccountSharing, BudgetSource, CategoryKind, LlmProvider, Role } from "@prisma/client";
import { getScope, setSharing } from "@/lib/access";
import {
  changePassword, checkCredentials, clearLoginFailures, createMember, endSession, householdExists, loginBlocked,
  recordLoginFailure, requireAdmin, requireUser, setDisabled, setRole, setupHousehold, startSession, updateDisplayName, updateHousehold,
} from "@/lib/auth";
import {
  adjustBalance, archiveAccount, createAccount, createEntry, deleteAccount, createTransfer, deleteTransaction, getTransaction, LedgerError, NotFoundError,
  parseDay, todayIn, unarchiveAccount, updateAccount, updateEntry, updateTransfer, type EntryInput, type TransferInput,
} from "@/lib/ledger";
import { addDefaultCategories, createCategory, deleteCategory, parseForecast, setCategoryArchived, updateCategory, type CategoryFields } from "@/lib/categories";
import { addItem, createBudget, formatMonth, type IncomeLine, moveItem, parseMonth, removeItem, saveItems, setBudgetStatus, type ItemFields } from "@/lib/budget";
import { createCharge, deleteCharge, payCharge, updateCharge, type ChargeInput } from "@/lib/charges";
import { createLoan, deleteLoan, prepay, updateLoan, type LoanInput } from "@/lib/loans";
import { configuredProviders } from "@/lib/llm";
import { parseCents } from "@/lib/money";
import { applyAllocations, applyCategories, generateReport } from "@/lib/report";
import { itemSignature } from "./budget/signature";
import type { FormState } from "./form";
import { itemFlags, ownerField, sharedField, str } from "./form-fields";

const ACCOUNT_KINDS: AccountKind[] = ["CHECKING", "SAVINGS", "CASH", "OTHER"];
const AMOUNT_ERROR = "Montant invalide : nombre supérieur à 0, 2 décimales au plus (ex. 12,50).";

/** Erreurs de validation accumulées champ par champ. */
class Errors {
  fields: Record<string, string> = {};
  add(field: string, message: string) {
    this.fields[field] ??= message;
  }
  get state(): FormState | null {
    return Object.keys(this.fields).length ? { fields: this.fields } : null;
  }
}

/** Exécute une écriture métier ; renvoie l'état d'erreur du formulaire, ou null si succès. */
async function run(fn: () => Promise<unknown>): Promise<FormState | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    // `error` toujours renseigné : affiché en tête si aucun <Field> du formulaire ne porte ce champ (cf. globals.css).
    if (e instanceof LedgerError) return { error: e.message, fields: e.field ? { [e.field]: e.message } : undefined };
    if (e instanceof NotFoundError) return { error: "Élément introuvable." };
    throw e;
  }
}

function amountField(fd: FormData, errors: Errors) {
  const amount = parseCents(str(fd, "amount"));
  if (amount === null) errors.add("amount", AMOUNT_ERROR);
  return amount ?? 0;
}

function dayField(fd: FormData, errors: Errors) {
  const day = parseDay(str(fd, "occurredOn"));
  if (!day) errors.add("occurredOn", "Date invalide.");
  return day ?? new Date(0);
}

const noteField = (fd: FormData) => str(fd, "note").slice(0, 500) || null;

function passwordField(fd: FormData, errors: Errors) {
  const password = String(fd.get("password") ?? "");
  if (password.length < 8) errors.add("password", "8 caractères minimum.");
  return password;
}

function emailField(fd: FormData, errors: Errors) {
  const email = str(fd, "email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) errors.add("email", "Adresse email invalide.");
  return email;
}

function requiredField(fd: FormData, name: string, errors: Errors) {
  const value = str(fd, name).slice(0, 100);
  if (!value) errors.add(name, "Champ obligatoire.");
  return value;
}

/** Utilisateur connecté et sa portée (comptes lisibles / modifiables). */
async function requireScope() {
  const user = await requireUser();
  return { user, scope: await getScope(user) };
}

function done(path: string): never {
  revalidatePath("/", "layout");
  redirect(path);
}

// --- Setup, connexion, déconnexion ---

/** Jeton d'installation facultatif (SETUP_TOKEN) : exigé par /setup quand il est défini. */
function setupTokenOk(given: string) {
  const expected = process.env.SETUP_TOKEN ?? "";
  if (!expected) return true;
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function setupAction(_: FormState, fd: FormData): Promise<FormState> {
  if (await householdExists()) redirect("/login");
  if (!setupTokenOk(String(fd.get("setupToken") ?? ""))) return { fields: { setupToken: "Jeton d’installation incorrect." } };
  const errors = new Errors();
  const input = {
    householdName: requiredField(fd, "householdName", errors),
    name: requiredField(fd, "name", errors),
    email: emailField(fd, errors),
    password: passwordField(fd, errors),
  };
  if (errors.state) return errors.state;
  const admin = await setupHousehold(input);
  if (!admin) redirect("/login"); // un autre setup a gagné la course
  await startSession(admin.id);
  done("/tableau-de-bord");
}

export async function loginAction(_: FormState, fd: FormData): Promise<FormState> {
  const h = await headers();
  // Entrée la plus à droite : ajoutée par le reverse proxy, non choisie par le client.
  const ip = h.get("x-forwarded-for")?.split(",").at(-1)?.trim() || h.get("x-real-ip")?.trim() || "";
  const email = str(fd, "email").toLowerCase();
  const neutral = { error: "Connexion impossible. Vérifiez vos identifiants ou réessayez plus tard." };
  if (loginBlocked(ip, email)) return neutral;
  const user = await checkCredentials(email, String(fd.get("password") ?? ""));
  if (!user) {
    recordLoginFailure(ip, email);
    return neutral;
  }
  clearLoginFailures(ip, email);
  await startSession(user.id);
  done("/tableau-de-bord");
}

export async function logoutAction() {
  await endSession();
  redirect("/login");
}

// --- Membres ---

export async function createMemberAction(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const errors = new Errors();
  const role: Role = str(fd, "role") === "ADMIN" ? "ADMIN" : "MEMBER";
  const input = { name: requiredField(fd, "name", errors), email: emailField(fd, errors), password: passwordField(fd, errors), role };
  if (errors.state) return errors.state;
  if (!(await createMember(admin.householdId, input))) return { fields: { email: "Cette adresse est déjà utilisée." } };
  done("/members");
}

export async function setRoleAction(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const id = str(fd, "id");
  const role: Role = str(fd, "role") === "ADMIN" ? "ADMIN" : "MEMBER";
  const error = await run(() => setRole(admin.householdId, admin.id, id, role));
  if (error) return error;
  done(`/members/${encodeURIComponent(id)}`);
}

export async function setDisabledAction(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const id = str(fd, "id");
  const error = await run(() => setDisabled(admin.householdId, admin.id, id, str(fd, "disabled") === "1"));
  if (error) return error;
  done(`/members/${encodeURIComponent(id)}`);
}

// --- Préférences ---

/** Fournisseur choisi : vide → null (premier configuré) ; seuls les fournisseurs configurés sont acceptés. */
function providerField(fd: FormData, name: string, errors: Errors): LlmProvider | null {
  const raw = str(fd, name);
  if (!raw) return null;
  const provider = configuredProviders().find((p) => p === raw);
  if (!provider) errors.add(name, "Fournisseur non configuré.");
  return provider ?? null;
}

export async function updateProfileAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const errors = new Errors();
  const name = requiredField(fd, "name", errors);
  if (errors.state) return errors.state;
  await updateDisplayName(user.id, name);
  done("/parametres?ok=profil");
}

export async function updateHouseholdAction(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const errors = new Errors();
  const name = requiredField(fd, "householdName", errors);
  const budgetSource = str(fd, "budgetSource") as BudgetSource;
  if (budgetSource !== "PREVIOUS" && budgetSource !== "TEMPLATES") errors.add("budgetSource", "Choix invalide.");
  // Champ absent (aucun fournisseur configuré) : préférence inchangée.
  const llmProvider = fd.has("llmProvider") ? providerField(fd, "llmProvider", errors) : undefined;
  if (errors.state) return errors.state;
  await updateHousehold(admin.householdId, { name, budgetSource, llmProvider });
  done("/parametres?ok=foyer");
}

// --- Mon compte ---

export async function changePasswordAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const errors = new Errors();
  const current = String(fd.get("current") ?? "");
  if (!current) errors.add("current", "Champ obligatoire.");
  const password = passwordField(fd, errors);
  if (String(fd.get("confirm") ?? "") !== password) errors.add("confirm", "La confirmation ne correspond pas.");
  if (errors.state) return errors.state;
  const error = await run(() => changePassword(user.id, current, password));
  if (error) return error;
  done("/profil?ok=1");
}

// --- Comptes ---

function accountFields(fd: FormData, errors: Errors) {
  const kind = str(fd, "kind") as AccountKind;
  if (!ACCOUNT_KINDS.includes(kind)) errors.add("kind", "Type de compte invalide.");
  // Propriétaire inchangé : à la création, le créateur.
  return { kind, name: requiredField(fd, "name", errors), notes: str(fd, "notes").slice(0, 1000), ownerId: ownerField(fd) };
}

function sharingField(fd: FormData) {
  return (str(fd, "sharing") === "HOUSEHOLD" ? "HOUSEHOLD" : "SELECTED") as AccountSharing;
}

export async function createAccountAction(_: FormState, fd: FormData): Promise<FormState> {
  const { user, scope } = await requireScope();
  const errors = new Errors();
  const data = accountFields(fd, errors);
  const raw = str(fd, "initialBalance");
  const initialBalance = raw === "" ? 0 : parseCents(raw, { allowSigned: true });
  if (initialBalance === null) errors.add("initialBalance", "Montant invalide (ex. 1 234,56 ou -20), 2 décimales au plus.");
  if (errors.state) return errors.state;
  let id = "";
  const error = await run(async () => (id = (await createAccount(scope, user.id, { ...data, initialBalance: initialBalance!, sharing: sharingField(fd) })).id));
  if (error) return error;
  done(`/accounts/${id}`);
}

const ACCESS_LEVELS: AccessLevel[] = ["READ", "WRITE", "MANAGE"];

/** Partage d'un compte : mode + un champ `access:<userId>` = NONE | READ | WRITE | MANAGE par utilisateur. */
export async function saveSharingAction(_: FormState, fd: FormData): Promise<FormState> {
  const { user, scope } = await requireScope();
  const id = str(fd, "id");
  const levels = new Map<string, AccessLevel | null>();
  for (const [key, value] of fd) {
    if (!key.startsWith("access:")) continue;
    const level = String(value);
    if (level !== "NONE" && !ACCESS_LEVELS.includes(level as AccessLevel)) return { error: "Niveau d’accès invalide." };
    levels.set(key.slice("access:".length), level === "NONE" ? null : (level as AccessLevel));
  }
  const error = await run(() => setSharing(scope, user.id, id, sharingField(fd), levels));
  if (error) return error;
  done(`/accounts/${id}`);
}

export async function updateAccountAction(_: FormState, fd: FormData): Promise<FormState> {
  const { user, scope } = await requireScope();
  const id = str(fd, "id");
  const errors = new Errors();
  const data = accountFields(fd, errors);
  if (errors.state) return errors.state;
  const month = parseMonth(todayIn(user.household.timezone).slice(0, 7))!;
  const error = await run(() => updateAccount(scope, id, data, month));
  if (error) return error;
  done(`/accounts/${id}`);
}

/** Ajuste le solde au montant saisi (opération d'écart datée du jour) ; rien si déjà égal. */
export async function adjustBalanceAction(_: FormState, fd: FormData): Promise<FormState> {
  const { user, scope } = await requireScope();
  const id = str(fd, "id");
  const target = parseCents(str(fd, "target"), { allowSigned: true });
  if (target === null) return { fields: { target: "Montant invalide (ex. 1 234,56 ou -20), 2 décimales au plus." } };
  const error = await run(() => adjustBalance(scope, user.id, id, target, parseDay(todayIn(user.household.timezone))!));
  if (error) return error;
  done(`/accounts/${id}`);
}

export async function archiveAccountAction(_: FormState, fd: FormData): Promise<FormState> {
  const { scope } = await requireScope();
  const id = str(fd, "id");
  const restore = str(fd, "restore") === "1";
  const error = await run(() => (restore ? unarchiveAccount(scope, id) : archiveAccount(scope, id)));
  if (error) return error;
  done(`/accounts/${id}`);
}

export async function deleteAccountAction(_: FormState, fd: FormData): Promise<FormState> {
  const { scope } = await requireScope();
  const error = await run(() => deleteAccount(scope, str(fd, "id")));
  if (error) return error;
  done("/accounts");
}

// --- Recettes, dépenses, virements ---

function entryFields(fd: FormData, errors: Errors): EntryInput {
  const kind = str(fd, "kind");
  if (kind !== "INCOME" && kind !== "EXPENSE") errors.add("kind", "Choisissez dépense ou recette.");
  return {
    accountId: str(fd, "accountId"), kind: kind as EntryInput["kind"], amount: amountField(fd, errors), occurredOn: dayField(fd, errors),
    note: noteField(fd), categoryId: str(fd, "categoryId") || null,
    shared: sharedField(fd), // case non affichée (compte commun) : valeur laissée au serveur
  };
}

function transferFields(fd: FormData, errors: Errors): TransferInput {
  const fromAccountId = str(fd, "fromAccountId"), toAccountId = str(fd, "toAccountId");
  if (!fromAccountId) errors.add("fromAccountId", "Champ obligatoire.");
  if (!toAccountId) errors.add("toAccountId", "Champ obligatoire.");
  return { fromAccountId, toAccountId, amount: amountField(fd, errors), occurredOn: dayField(fd, errors), note: noteField(fd) };
}

/** Clé générée par le formulaire (une par affichage) : rejouer la soumission ne crée pas de doublon. */
const idempotencyKey = (fd: FormData) => str(fd, "idempotencyKey").slice(0, 100) || null;

export async function createEntryAction(_: FormState, fd: FormData): Promise<FormState> {
  const { user, scope } = await requireScope();
  const errors = new Errors();
  const input = entryFields(fd, errors);
  if (errors.state) return errors.state;
  const error = await run(() => createEntry(scope, user.id, { ...input, idempotencyKey: idempotencyKey(fd) }));
  if (error) return error;
  // Liste blanche : seule la valeur fixe « dashboard » change la page de retour.
  done(str(fd, "back") === "dashboard" ? "/tableau-de-bord" : `/accounts/${input.accountId}`);
}

export async function createTransferAction(_: FormState, fd: FormData): Promise<FormState> {
  const { user, scope } = await requireScope();
  const errors = new Errors();
  const input = transferFields(fd, errors);
  if (errors.state) return errors.state;
  const error = await run(() => createTransfer(scope, user.id, { ...input, idempotencyKey: idempotencyKey(fd) }));
  if (error) return error;
  done(`/accounts/${str(fd, "returnTo") || input.fromAccountId}`);
}

/** Modifie une transaction : un virement est toujours modifié des deux côtés. */
export async function updateTransactionAction(_: FormState, fd: FormData): Promise<FormState> {
  const { scope } = await requireScope();
  const id = str(fd, "id");
  const errors = new Errors();
  const error = await run(async () => {
    const t = await getTransaction(scope, id);
    if (t.transferId) {
      const input = transferFields(fd, errors);
      if (!errors.state) await updateTransfer(scope, t.transferId, input);
    } else {
      const input = entryFields(fd, errors);
      if (!errors.state) await updateEntry(scope, id, input);
    }
  });
  if (errors.state) return errors.state;
  if (error) return error;
  done(`/accounts/${str(fd, "returnTo")}`);
}

export async function deleteTransactionAction(_: FormState, fd: FormData): Promise<FormState> {
  const { scope } = await requireScope();
  const error = await run(() => deleteTransaction(scope, str(fd, "id")));
  if (error) return error;
  done(`/accounts/${str(fd, "returnTo")}`);
}

// --- Catégories (catalogue réservé aux admins) ---

function categoryFields(fd: FormData, errors: Errors): CategoryFields {
  const forecastAmount = parseForecast(str(fd, "forecastAmount"));
  if (forecastAmount === undefined) errors.add("forecastAmount", "Montant invalide : 0 ou plus, 2 décimales au plus (ex. 150 ou 12,50).");
  const sortOrder = Number(str(fd, "sortOrder") || "0");
  if (!Number.isInteger(sortOrder) || Math.abs(sortOrder) > 100_000) errors.add("sortOrder", "Ordre invalide : nombre entier.");
  return {
    name: requiredField(fd, "name", errors), forecastAmount: forecastAmount ?? 0, sortOrder,
    enabled: fd.get("enabled") === "on", recurring: fd.get("recurring") === "on", isTemplate: fd.get("isTemplate") === "on",
    fixed: fd.has("fixed") ? fd.get("fixed") === "1" : undefined, // champ affiché seulement pour une dépense de premier niveau
  };
}

export async function createCategoryAction(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const errors = new Errors();
  const kind = str(fd, "kind");
  if (kind !== "INCOME" && kind !== "EXPENSE") errors.add("kind", "Choisissez dépense ou revenu.");
  const input = { ...categoryFields(fd, errors), kind: kind as CategoryKind, parentId: str(fd, "parentId") || null };
  if (errors.state) return errors.state;
  const error = await run(() => createCategory(admin.householdId, input));
  if (error) return error;
  done("/categories");
}

export async function updateCategoryAction(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const errors = new Errors();
  const input = categoryFields(fd, errors);
  if (errors.state) return errors.state;
  const error = await run(() => updateCategory(admin.householdId, str(fd, "id"), input));
  if (error) return error;
  done("/categories");
}

export async function archiveCategoryAction(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const error = await run(() => setCategoryArchived(admin.householdId, str(fd, "id"), str(fd, "restore") !== "1"));
  if (error) return error;
  done("/categories");
}

export async function deleteCategoryAction(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const error = await run(() => deleteCategory(admin.householdId, str(fd, "id")));
  if (error) return error;
  done("/categories");
}

export async function addDefaultCategoriesAction(): Promise<FormState> {
  const admin = await requireAdmin();
  await addDefaultCategories(admin.householdId);
  done("/categories");
}

// --- Budget mensuel (aucune opération, aucun solde n'est modifié ici) ---

const BUDGET_AMOUNT = "Montant invalide : 0 ou plus, 2 décimales au plus (ex. 150 ou 12,50).";

export async function createBudgetAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const month = parseMonth(str(fd, "month"));
  if (!month) return { error: "Mois invalide." };
  // Revenus saisis à la création : lignes `inc:label` / `inc:amount` / `inc:cat` ; ligne sans libellé ni montant ignorée.
  const labels = fd.getAll("inc:label"), amounts = fd.getAll("inc:amount"), cats = fd.getAll("inc:cat");
  const incomes: IncomeLine[] = [];
  for (const [k, l] of labels.entries()) {
    const label = String(l).trim().slice(0, 100), raw = String(amounts[k] ?? "").trim();
    if (!label && !raw) continue;
    if (!label) return { error: "Libellé obligatoire pour chaque revenu." };
    const amount = parseForecast(raw);
    if (amount === undefined) return { error: `${label} : ${BUDGET_AMOUNT}` };
    incomes.push({ label, amount, categoryId: String(cats[k] ?? "") || null });
  }
  await createBudget(user.householdId, month, labels.length ? incomes : undefined);
  done(`/budget?m=${formatMonth(month)}`);
}

/** Champs d'une ligne `<prefix>label`, `<prefix>amount`… ; montant vide = 0. */
function itemFields(fd: FormData, prefix: string, errors: Errors): ItemFields {
  const label = str(fd, `${prefix}label`).slice(0, 100);
  if (!label) errors.add(`${prefix}label`, "Libellé obligatoire.");
  const amount = parseForecast(str(fd, `${prefix}amount`));
  if (amount === undefined) errors.add(`${prefix}amount`, BUDGET_AMOUNT);
  return {
    label, amount: amount ?? 0, included: fd.get(`${prefix}included`) === "on", recurring: fd.get(`${prefix}recurring`) === "on", ...itemFlags(fd, prefix),
  };
}

/**
 * Formulaire unique du budget : enregistre les lignes modifiées (signature `sig:<id>` inchangée = ligne ignorée,
 * pour ne pas écraser la saisie d'un autre membre), puis applique le bouton utilisé :
 * `op=save`, `op=remove:<id>`, `op=move:<up|down>:<id>`, `op=add:<INCOME|EXPENSE|parentId>`, `op=status:<DRAFT|VALIDATED>`.
 */
export async function budgetAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const month = parseMonth(str(fd, "month"));
  if (!month) return { error: "Mois invalide." };
  const budgetId = str(fd, "budgetId");
  const op = str(fd, "op");
  const errors = new Errors();

  const changed = new Map<string, ItemFields>();
  for (const id of fd.getAll("item").map(String)) {
    const f = itemFields(fd, `${id}:`, errors);
    if (itemSignature(f) !== str(fd, `sig:${id}`)) changed.set(id, f);
  }
  let added: (ItemFields & { kind: CategoryKind; parentId: string | null }) | null = null;
  if (op.startsWith("add:")) {
    const target = op.slice(4);
    const kind = target === "INCOME" || target === "EXPENSE" ? target : "EXPENSE";
    const fields = itemFields(fd, `new:${target}:`, errors);
    added = { ...fields, included: true, recurring: true, kind, parentId: kind === target ? null : target };
  }
  if (errors.state) return errors.state;

  const error = await run(async () => {
    if (op.startsWith("status:")) {
      await setBudgetStatus(user.householdId, budgetId, op.slice(7) === "VALIDATED" ? "VALIDATED" : "DRAFT");
      return;
    }
    if (changed.size) await saveItems(user.householdId, budgetId, changed);
    if (op.startsWith("remove:")) await removeItem(user.householdId, budgetId, op.slice(7));
    if (op.startsWith("move:")) await moveItem(user.householdId, budgetId, op.slice(op.indexOf(":", 5) + 1), op.startsWith("move:up:") ? "up" : "down");
    if (added) await addItem(user.householdId, budgetId, added);
  });
  if (error) return error;
  done(`/budget?m=${formatMonth(month)}&ok=1`);
}

// --- Charges fixes ---

function chargeFields(fd: FormData, errors: Errors): ChargeInput {
  const dueDay = Number(str(fd, "dueDay"));
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) errors.add("dueDay", "Jour invalide : entre 1 et 31.");
  const startMonth = parseMonth(str(fd, "startMonth"));
  if (!startMonth) errors.add("startMonth", "Mois invalide.");
  const rawEnd = str(fd, "endMonth");
  const endMonth = rawEnd ? parseMonth(rawEnd) : null;
  if (rawEnd && !endMonth) errors.add("endMonth", "Mois invalide.");
  const accountId = str(fd, "accountId");
  if (!accountId) errors.add("accountId", "Champ obligatoire.");
  const categoryId = str(fd, "categoryId");
  if (!categoryId) errors.add("categoryId", "Champ obligatoire.");
  const kind = str(fd, "kind");
  if (kind !== "INCOME" && kind !== "EXPENSE") errors.add("kind", "Choisissez revenu ou dépense.");
  return {
    kind: kind as CategoryKind, active: fd.get("active") === "on",
    name: requiredField(fd, "name", errors), amount: amountField(fd, errors), dueDay, accountId, categoryId,
    startMonth: startMonth ?? new Date(0), endMonth, shared: sharedField(fd) ?? true,
  };
}

export async function createChargeAction(_: FormState, fd: FormData): Promise<FormState> {
  const { scope } = await requireScope();
  const errors = new Errors();
  const input = chargeFields(fd, errors);
  if (errors.state) return errors.state;
  const error = await run(() => createCharge(scope, input));
  if (error) return error;
  done("/charges");
}

export async function updateChargeAction(_: FormState, fd: FormData): Promise<FormState> {
  const { scope } = await requireScope();
  const errors = new Errors();
  const input = chargeFields(fd, errors);
  if (errors.state) return errors.state;
  const error = await run(() => updateCharge(scope, str(fd, "id"), input));
  if (error) return error;
  done("/charges");
}

export async function deleteChargeAction(_: FormState, fd: FormData): Promise<FormState> {
  const { scope } = await requireScope();
  const error = await run(() => deleteCharge(scope, str(fd, "id")));
  if (error) return error;
  done("/charges");
}

/** Marque une charge payée pour le mois : crée la dépense réelle (montant et date saisis). */
export async function payChargeAction(_: FormState, fd: FormData): Promise<FormState> {
  const { user, scope } = await requireScope();
  const month = parseMonth(str(fd, "month"));
  if (!month) return { error: "Mois invalide." };
  const errors = new Errors();
  const amount = amountField(fd, errors);
  const occurredOn = dayField(fd, errors);
  if (errors.state) return errors.state;
  const error = await run(() => payCharge(scope, user.id, str(fd, "id"), month, amount, occurredOn));
  if (error) return error;
  // Liste blanche : seule la valeur fixe « calendar » change la page de retour.
  done(`${str(fd, "back") === "calendar" ? "/calendrier" : "/charges"}?m=${formatMonth(month)}`);
}

// --- Crédits ---

/** Champ montant facultatif : vide → `empty` ; `min0` accepte 0. */
function optionalCents(fd: FormData, name: string, errors: Errors, empty: number | null, min0: boolean) {
  const raw = str(fd, name);
  if (!raw) return empty;
  const cents = parseCents(raw, { allowSigned: min0 });
  if (cents === null || cents < 0) errors.add(name, min0 ? "Montant invalide : 0 ou plus (ex. 15 ou 12,50)." : AMOUNT_ERROR);
  return cents ?? 0;
}

/**
 * Crédit simple (capital vide) : nom, 1ʳᵉ échéance, nombre et montant des échéances → taux 0, capital = montant × nombre.
 * Capital saisi : prêt amortissable (taux obligatoire, mensualité calculée si vide).
 */
function loanFields(fd: FormData, errors: Errors): LoanInput {
  const termMonths = Number(str(fd, "termMonths"));
  if (!Number.isInteger(termMonths) || termMonths < 1 || termMonths > 600) errors.add("termMonths", "Nombre invalide : entre 1 et 600 échéances.");
  const payment = optionalCents(fd, "payment", errors, null, false);
  const simple = !str(fd, "principal");
  if (simple && payment === null) errors.add("payment", "Indiquez le montant de chaque échéance.");
  const principal = simple ? (payment ?? 0) * termMonths : parseCents(str(fd, "principal"));
  if (principal === null) errors.add("principal", AMOUNT_ERROR);
  // « 3,45 » → 3450 (millièmes de pour cent) ; vide pour un crédit simple = 0
  const rate = /^(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(str(fd, "annualRate") || (simple ? "0" : ""));
  const annualRate = rate ? Number(rate[1]) * 1000 + Number((rate[2] ?? "").padEnd(3, "0")) : -1;
  if (annualRate < 0 || annualRate > 50_000) errors.add("annualRate", "Taux invalide : entre 0 et 50 %, 3 décimales au plus (ex. 3,45).");
  const firstDue = parseDay(str(fd, "firstDue"));
  if (!firstDue) errors.add("firstDue", "Date invalide.");
  const accountId = str(fd, "accountId");
  if (!accountId) errors.add("accountId", "Champ obligatoire.");
  const categoryId = str(fd, "categoryId");
  if (!categoryId) errors.add("categoryId", "Champ obligatoire.");
  return {
    name: requiredField(fd, "name", errors), accountId, categoryId, firstDue: firstDue ?? new Date(0),
    principal: principal ?? 0, annualRate, termMonths,
    payment, insurance: optionalCents(fd, "insurance", errors, 0, true)!,
  };
}

export async function createLoanAction(_: FormState, fd: FormData): Promise<FormState> {
  const { scope } = await requireScope();
  const errors = new Errors();
  const input = loanFields(fd, errors);
  if (errors.state) return errors.state;
  let id = "";
  const error = await run(async () => (id = (await createLoan(scope, input)).id));
  if (error) return error;
  done(`/credits/${id}`);
}

export async function updateLoanAction(_: FormState, fd: FormData): Promise<FormState> {
  const { scope } = await requireScope();
  const id = str(fd, "id");
  const errors = new Errors();
  const input = loanFields(fd, errors);
  if (errors.state) return errors.state;
  const error = await run(() => updateLoan(scope, id, input));
  if (error) return error;
  done(`/credits/${id}`);
}

export async function deleteLoanAction(_: FormState, fd: FormData): Promise<FormState> {
  const { scope } = await requireScope();
  const error = await run(() => deleteLoan(scope, str(fd, "id")));
  if (error) return error;
  done("/credits");
}

/** Remboursement anticipé : crée la dépense réelle (compte et catégorie du crédit). */
export async function prepayLoanAction(_: FormState, fd: FormData): Promise<FormState> {
  const { user, scope } = await requireScope();
  const id = str(fd, "id");
  const errors = new Errors();
  const amount = amountField(fd, errors);
  const occurredOn = dayField(fd, errors);
  const mode = str(fd, "mode");
  if (mode !== "REDUCE_TERM" && mode !== "REDUCE_PAYMENT") errors.add("mode", "Choisissez un mode.");
  if (errors.state) return errors.state;
  const error = await run(() => prepay(scope, user.id, id, amount, occurredOn, mode as "REDUCE_TERM"));
  if (error) return error;
  done(`/credits/${id}`);
}

// --- Rapports (rien n'est écrit dans le budget ni les opérations sans clic explicite) ---

/** Rapport à la demande (MANUAL) ; `provider` facultatif = essai ponctuel, sinon préférence du foyer. */
export async function analyzeAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const errors = new Errors();
  const provider = providerField(fd, "provider", errors) ?? undefined;
  if (errors.state) return errors.state;
  let id = "";
  const error = await run(async () => (id = (await generateReport(user, parseDay(todayIn(user.household.timezone))!, "MANUAL", provider)).id));
  if (error) return error;
  done(`/rapports?id=${encodeURIComponent(id)}`);
}

export async function applyAllocationsAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const id = str(fd, "reportId");
  let n = 0;
  const error = await run(async () => (n = await applyAllocations(user, id)));
  if (error) return error;
  done(`/rapports?id=${encodeURIComponent(id)}&lignes=${n}`);
}

export async function applyCategoriesAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const id = str(fd, "reportId");
  let n = 0;
  const error = await run(async () => (n = await applyCategories(user, id)));
  if (error) return error;
  done(`/rapports?id=${encodeURIComponent(id)}&operations=${n}`);
}
