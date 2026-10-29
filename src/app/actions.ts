"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { AccountKind, CarryOver, Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  checkCredentials, clearLoginFailures, createMember, endSession, householdExists, loginBlocked,
  recordLoginFailure, requireAdmin, requireUser, setupHousehold, startSession,
} from "@/lib/auth";
import {
  archiveAccount, createEntry, createTransfer, deleteTransaction, getTransaction, LedgerError, NotFoundError,
  parseDay, updateEntry, updateTransfer, type EntryInput, type TransferInput,
} from "@/lib/ledger";
import { addDefaultCategories, createCategory, deleteCategory, parseForecast, updateCategory, type CategoryFields } from "@/lib/categories";
import { formatMonth, parseMonth, savePlanned } from "@/lib/budget";
import { parseCents } from "@/lib/money";
import type { FormState } from "./form";

const ACCOUNT_KINDS: AccountKind[] = ["CHECKING", "SAVINGS", "CASH", "OTHER"];
const AMOUNT_ERROR = "Montant invalide : nombre supérieur à 0, 2 décimales au plus (ex. 12,50).";

const str = (fd: FormData, name: string) => String(fd.get(name) ?? "").trim();

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

function done(path: string): never {
  revalidatePath("/", "layout");
  redirect(path);
}

// --- Setup, connexion, déconnexion ---

export async function setupAction(_: FormState, fd: FormData): Promise<FormState> {
  if (await householdExists()) redirect("/login");
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
  done("/accounts");
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
  done("/accounts");
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

// --- Comptes ---

function accountFields(fd: FormData, errors: Errors) {
  const kind = str(fd, "kind") as AccountKind;
  if (!ACCOUNT_KINDS.includes(kind)) errors.add("kind", "Type de compte invalide.");
  const raw = str(fd, "initialBalance");
  const initialBalance = raw === "" ? 0 : parseCents(raw, { allowSigned: true });
  if (initialBalance === null) errors.add("initialBalance", "Montant invalide (ex. 1 234,56 ou -20).");
  return { kind, name: requiredField(fd, "name", errors), initialBalance: initialBalance ?? 0 };
}

export async function createAccountAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const errors = new Errors();
  const data = accountFields(fd, errors);
  if (errors.state) return errors.state;
  const account = await prisma.account.create({ data: { ...data, householdId: user.householdId } });
  done(`/accounts/${account.id}`);
}

export async function updateAccountAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const id = str(fd, "id");
  const errors = new Errors();
  const data = accountFields(fd, errors);
  if (errors.state) return errors.state;
  const { count } = await prisma.account.updateMany({ where: { id, householdId: user.householdId, archivedAt: null }, data });
  if (!count) return { error: "Compte introuvable ou archivé." };
  done(`/accounts/${id}`);
}

export async function archiveAccountAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const id = str(fd, "id");
  const error = await run(() => archiveAccount(user.householdId, id));
  if (error) return error;
  done(`/accounts/${id}`);
}

// --- Recettes, dépenses, virements ---

function entryFields(fd: FormData, errors: Errors): EntryInput {
  const kind = str(fd, "kind");
  if (kind !== "INCOME" && kind !== "EXPENSE") errors.add("kind", "Choisissez dépense ou recette.");
  return {
    accountId: str(fd, "accountId"), kind: kind as EntryInput["kind"], amount: amountField(fd, errors), occurredOn: dayField(fd, errors),
    note: noteField(fd), categoryId: str(fd, "categoryId") || null,
  };
}

function transferFields(fd: FormData, errors: Errors): TransferInput {
  return { fromAccountId: str(fd, "fromAccountId"), toAccountId: str(fd, "toAccountId"), amount: amountField(fd, errors), occurredOn: dayField(fd, errors), note: noteField(fd) };
}

export async function createEntryAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const errors = new Errors();
  const input = entryFields(fd, errors);
  if (errors.state) return errors.state;
  const error = await run(() => createEntry(user.householdId, user.id, input));
  if (error) return error;
  done(`/accounts/${input.accountId}`);
}

export async function createTransferAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const errors = new Errors();
  const input = transferFields(fd, errors);
  if (errors.state) return errors.state;
  const error = await run(() => createTransfer(user.householdId, user.id, input));
  if (error) return error;
  done(`/accounts/${str(fd, "returnTo") || input.fromAccountId}`);
}

/** Modifie une transaction : un virement est toujours modifié des deux côtés. */
export async function updateTransactionAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const id = str(fd, "id");
  const errors = new Errors();
  const error = await run(async () => {
    const t = await getTransaction(user.householdId, id);
    if (t.transferId) {
      const input = transferFields(fd, errors);
      if (!errors.state) await updateTransfer(user.householdId, t.transferId, input);
    } else {
      const input = entryFields(fd, errors);
      if (!errors.state) await updateEntry(user.householdId, id, input);
    }
  });
  if (errors.state) return errors.state;
  if (error) return error;
  done(`/accounts/${str(fd, "returnTo")}`);
}

export async function deleteTransactionAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const error = await run(() => deleteTransaction(user.householdId, str(fd, "id")));
  if (error) return error;
  done(`/accounts/${str(fd, "returnTo")}`);
}

// --- Catégories ---

const CARRY_OVERS: CarryOver[] = ["PREVIOUS", "FORECAST", "NONE"];

function categoryFields(fd: FormData, errors: Errors): CategoryFields {
  const forecastAmount = parseForecast(str(fd, "forecastAmount"));
  if (forecastAmount === undefined) errors.add("forecastAmount", "Montant invalide : 0 ou plus (ex. 150 ou 12,50).");
  const carryOver = str(fd, "carryOver") as CarryOver;
  if (!CARRY_OVERS.includes(carryOver)) errors.add("carryOver", "Règle de reconduction invalide.");
  return { name: requiredField(fd, "name", errors), forecastAmount: forecastAmount ?? null, carryOver, enabled: fd.get("enabled") === "on" };
}

export async function createCategoryAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const errors = new Errors();
  const kind = str(fd, "kind");
  if (kind !== "INCOME" && kind !== "EXPENSE") errors.add("kind", "Choisissez dépense ou revenu.");
  const input = { ...categoryFields(fd, errors), kind: kind as "INCOME" | "EXPENSE", parentId: str(fd, "parentId") || null };
  if (errors.state) return errors.state;
  const error = await run(() => createCategory(user.householdId, input));
  if (error) return error;
  done("/categories");
}

export async function updateCategoryAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const errors = new Errors();
  const input = categoryFields(fd, errors);
  if (errors.state) return errors.state;
  const error = await run(() => updateCategory(user.householdId, str(fd, "id"), input));
  if (error) return error;
  done("/categories");
}

export async function deleteCategoryAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const error = await run(() => deleteCategory(user.householdId, str(fd, "id")));
  if (error) return error;
  done("/categories");
}

export async function addDefaultCategoriesAction(): Promise<FormState> {
  const user = await requireUser();
  await addDefaultCategories(user.householdId);
  done("/categories");
}

// --- Budget ---

/** Montants prévus du mois : un champ `planned:<categoryId>` par catégorie (vide = à saisir). */
export async function saveBudgetAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const month = parseMonth(str(fd, "month"));
  if (!month) return { error: "Mois invalide." };
  const errors = new Errors();
  const planned = new Map<string, number | null>();
  for (const [key, value] of fd) {
    if (!key.startsWith("planned:")) continue;
    const raw = String(value).trim();
    // Champ inchangé depuis l'affichage : ne pas écraser la modification d'un autre membre.
    if (raw === str(fd, `orig:${key.slice("planned:".length)}`)) continue;
    const cents = parseForecast(raw);
    if (cents === undefined) errors.add(key, "Montant invalide : 0 ou plus (ex. 150 ou 12,50).");
    else planned.set(key.slice("planned:".length), cents);
  }
  if (errors.state) return errors.state;
  await savePlanned(user.householdId, month, planned);
  done(`/budget?m=${formatMonth(month)}`);
}
