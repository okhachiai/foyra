"use server";

import { timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { BudgetSource, CategoryKind, LlmProvider, Role } from "@prisma/client";
import {
  changePassword, checkCredentials, clearLoginFailures, createMember, endSession, householdExists, loginBlocked, MAX_PASSWORD,
  recordLoginFailure, requireAdmin, requireUser, setDisabled, setRole, setupHousehold, setupToken, startSession, updateDisplayName, updateHousehold,
} from "@/lib/auth";
import { createEntry, deleteTransaction, LedgerError, NotFoundError, parseDay, todayIn, updateEntry, type EntryInput } from "@/lib/ledger";
import { addDefaultCategories, createCategory, deleteCategory, parseForecast, setCategoryArchived, updateCategory, type CategoryFields } from "@/lib/categories";
import { addItem, createBudget, formatMonth, type IncomeLine, itemSignature, moveItem, parseMonth, removeItem, saveItems, setBudgetStatus, type ItemFields } from "@/lib/budget";
import { createCharge, deleteCharge, payCharge, updateCharge, type ChargeInput } from "@/lib/charges";
import { createLoan, deleteLoan, prepay, updateLoan, type LoanInput } from "@/lib/loans";
import { configuredProviders, LlmError, localHostAllowed, PROVIDER_LABELS, sealSecret, testConnection, type LlmConfig } from "@/lib/llm";
import { parseCents } from "@/lib/money";
import { applyPlan, generateReport } from "@/lib/report";
import { importMonth, parseMonthFile, type MonthFile } from "@/lib/budget-file";
import { addSaving } from "@/lib/savings";
import type { FormState } from "./form";
import { itemFlags, sharedField, str } from "./form-fields";
import { LOCALE_COOKIE, toLocale } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n-server";

// Messages are English source text; ActionForm translates them for display (see i18n.ts).
const AMOUNT_ERROR = "Invalid amount: a number above 0, at most 2 decimals (e.g. 12.50).";

/** Validation errors, field → first message. */
type Errors = Record<string, string>;
const failed = (errors: Errors) => Object.keys(errors).length > 0;

/** Runs a business write; returns the form error state, or null on success. */
async function run(fn: () => Promise<unknown>): Promise<FormState | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    // `error` always set: shown at the top when no <Field> of the form carries that field (see globals.css).
    if (e instanceof LedgerError) return { error: e.message, fields: e.field ? { [e.field]: e.message } : undefined };
    if (e instanceof NotFoundError) return { error: "Item not found." };
    throw e;
  }
}

function amountField(fd: FormData, errors: Errors) {
  const amount = parseCents(str(fd, "amount"));
  if (amount === null) errors.amount ??= AMOUNT_ERROR;
  return amount ?? 0;
}

function dayField(fd: FormData, errors: Errors) {
  const day = parseDay(str(fd, "occurredOn"));
  if (!day) errors.occurredOn ??= "Invalid date.";
  return day ?? new Date(0);
}

const noteField = (fd: FormData) => str(fd, "note").slice(0, 500) || null;

async function passwordField(fd: FormData, errors: Errors) {
  const password = String(fd.get("password") ?? "");
  if (password.length < 8) errors.password ??= "8 characters minimum.";
  if (password.length > MAX_PASSWORD) errors.password ??= (await getI18n()).t("{n} characters maximum.", { n: MAX_PASSWORD });
  return password;
}

function emailField(fd: FormData, errors: Errors) {
  const email = str(fd, "email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) errors.email ??= "Invalid email address.";
  return email;
}

function requiredField(fd: FormData, name: string, errors: Errors) {
  const value = str(fd, name).slice(0, 100);
  if (!value) errors[name] ??= "Required field.";
  return value;
}

function done(path: string): never {
  revalidatePath("/", "layout");
  redirect(path);
}

// --- Setup, sign-in, sign-out ---

/** Setup token (SETUP_TOKEN, or the one in the server logs): always required by /setup. */
function setupTokenOk(given: string) {
  const a = Buffer.from(given), b = Buffer.from(setupToken());
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function setupAction(_: FormState, fd: FormData): Promise<FormState> {
  if (await householdExists()) redirect("/login");
  if (!setupTokenOk(String(fd.get("setupToken") ?? ""))) return { fields: { setupToken: "Incorrect setup token." } };
  const errors: Errors = {};
  const input = {
    householdName: requiredField(fd, "householdName", errors),
    name: requiredField(fd, "name", errors),
    email: emailField(fd, errors),
    password: await passwordField(fd, errors),
  };
  if (failed(errors)) return { fields: errors };
  const admin = await setupHousehold(input);
  if (!admin) redirect("/login"); // another setup won the race
  await startSession(admin.id);
  done("/dashboard");
}

export async function loginAction(_: FormState, fd: FormData): Promise<FormState> {
  const h = await headers();
  // Behind the reverse proxy (APP_URL set): right-most entry, added by the proxy.
  // Without a proxy these headers are client-chosen: rate limiting by email only.
  const ip = process.env.APP_URL ? h.get("x-forwarded-for")?.split(",").at(-1)?.trim() || h.get("x-real-ip")?.trim() || "" : "";
  const email = str(fd, "email").toLowerCase();
  const neutral = { error: "Unable to sign in. Check your credentials or try again later." };
  if (loginBlocked(ip, email)) return neutral;
  const user = await checkCredentials(email, String(fd.get("password") ?? ""));
  if (!user) {
    recordLoginFailure(ip, email);
    return neutral;
  }
  clearLoginFailures(ip, email);
  await startSession(user.id);
  done("/dashboard");
}

export async function logoutAction() {
  await endSession();
  redirect("/login");
}

// --- Language ---

/** Interface language, kept for a year in a cookie (per browser); unknown values fall back to English. */
export async function setLocaleAction(fd: FormData) {
  (await cookies()).set(LOCALE_COOKIE, toLocale(str(fd, "locale")), { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: true });
  revalidatePath("/", "layout");
}

// --- Members ---

export async function createMemberAction(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const errors: Errors = {};
  const role: Role = str(fd, "role") === "ADMIN" ? "ADMIN" : "MEMBER";
  const input = { name: requiredField(fd, "name", errors), email: emailField(fd, errors), password: await passwordField(fd, errors), role };
  if (failed(errors)) return { fields: errors };
  if (!(await createMember(admin.householdId, input))) return { fields: { email: "This address is already in use." } };
  done("/members");
}

export async function setRoleAction(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const id = str(fd, "id");
  const role: Role = str(fd, "role") === "ADMIN" ? "ADMIN" : "MEMBER";
  return (await run(() => setRole(admin.householdId, admin.id, id, role))) ?? done(`/members/${encodeURIComponent(id)}`);
}

export async function setDisabledAction(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const id = str(fd, "id");
  return (await run(() => setDisabled(admin.householdId, admin.id, id, str(fd, "disabled") === "1"))) ?? done(`/members/${encodeURIComponent(id)}`);
}

// --- Preferences ---

/** Chosen provider: empty → null (first configured); only configured providers are accepted. */
function providerField(fd: FormData, name: string, config: LlmConfig, errors: Errors): LlmProvider | null {
  const raw = str(fd, name);
  if (!raw) return null;
  const provider = configuredProviders(config).find((p) => p === raw);
  if (!provider) errors[name] ??= "Provider not configured.";
  return provider ?? null;
}

export async function updateProfileAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const errors: Errors = {};
  const name = requiredField(fd, "name", errors);
  if (failed(errors)) return { fields: errors };
  await updateDisplayName(user.id, name);
  done("/settings?ok=profile");
}

export async function updateHouseholdAction(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const errors: Errors = {};
  const name = requiredField(fd, "householdName", errors);
  const budgetSource = str(fd, "budgetSource") as BudgetSource;
  if (budgetSource !== "PREVIOUS" && budgetSource !== "TEMPLATES") errors.budgetSource ??= "Invalid choice.";
  if (failed(errors)) return { fields: errors };
  await updateHousehold(admin.householdId, { name, budgetSource });
  done("/settings?ok=household");
}

/** Secret key: empty = unchanged (never shown again), `clear_<name>` checked = erased. Encrypted on save (an old plaintext key gets encrypted along the way). */
function secretField(fd: FormData, name: string, current: string | null) {
  if (fd.get(`clear_${name}`)) return null;
  const value = str(fd, name).slice(0, 500) || current;
  return value && sealSecret(value);
}

/** Household LLM settings; the preferred provider is validated against the submitted settings. */
export async function updateLlmAction(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const errors: Errors = {};
  const h = admin.household;
  const localLlmUrl = str(fd, "localLlmUrl").slice(0, 500).replace(/\/+$/, "") || null;
  if (localLlmUrl && !/^https?:\/\/[^\s/]/.test(localLlmUrl)) errors.localLlmUrl ??= "http(s) URL expected, e.g. http://localhost:11434";
  if (localLlmUrl && !localHostAllowed(localLlmUrl)) errors.localLlmUrl ??= "Host not allowed: the operator must add it to LLM_ALLOWED_HOSTS (e.g. host.docker.internal:11434).";
  const config: LlmConfig = {
    llmProvider: null,
    claudeApiKey: secretField(fd, "claudeApiKey", h.claudeApiKey),
    claudeModel: str(fd, "claudeModel").slice(0, 100) || null,
    localLlmUrl,
    localLlmModel: str(fd, "localLlmModel").slice(0, 100) || null,
    localLlmApiKey: secretField(fd, "localLlmApiKey", h.localLlmApiKey),
  };
  config.llmProvider = providerField(fd, "llmProvider", config, errors);
  if (failed(errors)) return { fields: errors };
  if (str(fd, "intent") === "test") return testLlm(config);
  await updateHousehold(admin.householdId, config);
  done("/settings/ai?ok=1");
}

/** Tests each filled-in provider with the form values (not saved). */
async function testLlm(config: LlmConfig): Promise<FormState> {
  const providers = configuredProviders(config);
  if (!providers.length) return { error: "No provider to test: enter the Claude key, or the local URL and model." };
  const { t } = await getI18n();
  const ok: string[] = [], ko: string[] = [];
  for (const p of providers) {
    try {
      ok.push(t("{provider}: connection succeeded (model {model}).", { provider: t(PROVIDER_LABELS[p]), model: await testConnection(p, config) }));
    } catch (e) {
      if (!(e instanceof LlmError)) throw e;
      ko.push(`${t(PROVIDER_LABELS[p])}: ${e.message}`);
    }
  }
  return { error: ko.join("\n") || undefined, notice: ok.join("\n") || undefined };
}

// --- My account ---

export async function changePasswordAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const errors: Errors = {};
  const current = String(fd.get("current") ?? "");
  if (!current) errors.current ??= "Required field.";
  const password = await passwordField(fd, errors);
  if (String(fd.get("confirm") ?? "") !== password) errors.confirm ??= "The confirmation does not match.";
  if (failed(errors)) return { fields: errors };
  return (await run(() => changePassword(user.id, current, password))) ?? done("/profile?ok=1");
}

// --- Income, expenses ---

function entryFields(fd: FormData, errors: Errors): EntryInput {
  const kind = str(fd, "kind");
  if (kind !== "INCOME" && kind !== "EXPENSE") errors.kind ??= "Choose expense or income.";
  const paidById = str(fd, "paidById");
  if (!paidById) errors.paidById ??= "Required field.";
  return {
    kind: kind as EntryInput["kind"], amount: amountField(fd, errors), occurredOn: dayField(fd, errors),
    note: noteField(fd), categoryId: str(fd, "categoryId") || null, paidById, shared: sharedField(fd),
  };
}

/** Key generated by the form (one per render): replaying the submission creates no duplicate. */
const idempotencyKey = (fd: FormData) => str(fd, "idempotencyKey").slice(0, 100) || null;

export async function createEntryAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const errors: Errors = {};
  const input = entryFields(fd, errors);
  if (failed(errors)) return { fields: errors };
  // Allow-list: only the fixed values "dashboard" and "budget" change the return page.
  const back = str(fd, "back");
  return (await run(() => createEntry(user.householdId, user.id, { ...input, idempotencyKey: idempotencyKey(fd) })))
    ?? done(back === "dashboard" ? "/dashboard" : `/${back === "budget" ? "budget" : "transactions"}?m=${formatMonth(input.occurredOn)}`);
}

export async function updateTransactionAction(_: FormState, fd: FormData): Promise<FormState> {
  const { householdId } = await requireUser();
  const errors: Errors = {};
  const input = entryFields(fd, errors);
  if (failed(errors)) return { fields: errors };
  return (await run(() => updateEntry(householdId, str(fd, "id"), input))) ?? done(`/transactions?m=${formatMonth(input.occurredOn)}`);
}

export async function deleteTransactionAction(_: FormState, fd: FormData): Promise<FormState> {
  const { householdId } = await requireUser();
  return (await run(() => deleteTransaction(householdId, str(fd, "id")))) ?? done("/transactions");
}

/** Savings deposit: an expense in the savings category (deducted from income), shared unless unchecked. */
export async function addSavingAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const errors: Errors = {};
  const amount = amountField(fd, errors), occurredOn = dayField(fd, errors);
  const paidById = str(fd, "paidById");
  if (!paidById) errors.paidById ??= "Required field.";
  if (failed(errors)) return { fields: errors };
  return (await run(() => addSaving(user.householdId, user.id, { amount, occurredOn, paidById, note: noteField(fd), shared: sharedField(fd), idempotencyKey: idempotencyKey(fd) }))) ?? done(`/savings?m=${formatMonth(occurredOn)}`);
}

// --- Categories (catalogue reserved to admins) ---

function categoryFields(fd: FormData, errors: Errors): CategoryFields {
  const sortOrder = Number(str(fd, "sortOrder") || "0");
  if (!Number.isInteger(sortOrder) || Math.abs(sortOrder) > 100_000) errors.sortOrder ??= "Invalid order: whole number.";
  return {
    name: requiredField(fd, "name", errors), sortOrder,
    enabled: fd.get("enabled") === "on", recurring: fd.get("recurring") === "on", isTemplate: fd.get("isTemplate") === "on",
    fixed: fd.has("fixed") ? fd.get("fixed") === "1" : undefined, // field shown only for a top-level expense
  };
}

export async function createCategoryAction(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const errors: Errors = {};
  const kind = str(fd, "kind");
  if (kind !== "INCOME" && kind !== "EXPENSE") errors.kind ??= "Choose expense or income.";
  const input = { ...categoryFields(fd, errors), kind: kind as CategoryKind, parentId: str(fd, "parentId") || null };
  if (failed(errors)) return { fields: errors };
  return (await run(() => createCategory(admin.householdId, input))) ?? done("/categories");
}

export async function updateCategoryAction(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const errors: Errors = {};
  const input = categoryFields(fd, errors);
  if (failed(errors)) return { fields: errors };
  return (await run(() => updateCategory(admin.householdId, str(fd, "id"), input))) ?? done("/categories");
}

export async function archiveCategoryAction(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  return (await run(() => setCategoryArchived(admin.householdId, str(fd, "id"), str(fd, "restore") !== "1"))) ?? done("/categories");
}

export async function deleteCategoryAction(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  return (await run(() => deleteCategory(admin.householdId, str(fd, "id")))) ?? done("/categories");
}

export async function addDefaultCategoriesAction(): Promise<FormState> {
  const admin = await requireAdmin();
  await addDefaultCategories(admin.householdId);
  done("/categories");
}

// --- Monthly budget (no transaction is changed here) ---

const BUDGET_AMOUNT = "Invalid amount: 0 or more, at most 2 decimals (e.g. 150 or 12.50).";

export async function createBudgetAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const month = parseMonth(str(fd, "month"));
  if (!month) return { error: "Invalid month." };
  // Income entered at creation: rows `inc:label` / `inc:amount` / `inc:cat`; a row with neither label nor amount is ignored.
  const labels = fd.getAll("inc:label"), amounts = fd.getAll("inc:amount"), cats = fd.getAll("inc:cat");
  const incomes: IncomeLine[] = [];
  for (const [k, l] of labels.entries()) {
    const label = String(l).trim().slice(0, 100), raw = String(amounts[k] ?? "").trim();
    if (!label && !raw) continue;
    if (!label) return { error: "Label required for each income." };
    const amount = parseForecast(raw);
    if (amount === undefined) return { error: `${label}: ${(await getI18n()).t(BUDGET_AMOUNT)}` };
    incomes.push({ label, amount, categoryId: String(cats[k] ?? "") || null });
  }
  await createBudget(user.householdId, month, labels.length ? incomes : undefined);
  done(`/budget?m=${formatMonth(month)}`);
}

/** Fields of a row `<prefix>label`, `<prefix>amount`…; empty amount = 0. */
function itemFields(fd: FormData, prefix: string, errors: Errors): ItemFields {
  const label = str(fd, `${prefix}label`).slice(0, 100);
  if (!label) errors[`${prefix}label`] ??= "Label required.";
  const amount = parseForecast(str(fd, `${prefix}amount`));
  if (amount === undefined) errors[`${prefix}amount`] ??= BUDGET_AMOUNT;
  return {
    label, amount: amount ?? 0, included: fd.get(`${prefix}included`) === "on", recurring: fd.get(`${prefix}recurring`) === "on", ...itemFlags(fd, prefix),
  };
}

/**
 * Single budget form: saves changed rows (unchanged `sig:<id>` signature = row skipped,
 * so another member's input is not overwritten), then applies the button used:
 * `op=save`, `op=remove:<id>`, `op=move:<up|down>:<id>`, `op=add:<INCOME|EXPENSE|parentId>`, `op=status:<DRAFT|VALIDATED>`.
 */
export async function budgetAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const month = parseMonth(str(fd, "month"));
  if (!month) return { error: "Invalid month." };
  const budgetId = str(fd, "budgetId");
  const op = str(fd, "op");
  const errors: Errors = {};

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
  if (failed(errors)) return { fields: errors };

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
  return error ?? done(`/budget?m=${formatMonth(month)}&ok=1`);
}

/** Import of an exported file (`file`): the file's month becomes identical to the source database's.
 * ADMIN only: the import creates and changes categories, charges and loans, and replaces every member's transactions. */
export async function importBudgetAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireAdmin();
  const file = fd.get("file");
  if (!(file instanceof File) || !file.size) return { error: "Choose an exported file (.json)." };
  if (file.size > 1_000_000) return { error: "File too large (1 MB maximum)." }; // Server Actions limit
  let data: MonthFile | undefined;
  return (await run(async () => importMonth(user.householdId, (data = parseMonthFile(await file.text()))))) ?? done(`/budget?m=${data!.month}&ok=1`);
}

// --- Fixed charges ---

function chargeFields(fd: FormData, errors: Errors): ChargeInput {
  const dueDay = Number(str(fd, "dueDay"));
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) errors.dueDay ??= "Invalid day: between 1 and 31.";
  const startMonth = parseMonth(str(fd, "startMonth"));
  if (!startMonth) errors.startMonth ??= "Invalid month.";
  const rawEnd = str(fd, "endMonth");
  const endMonth = rawEnd ? parseMonth(rawEnd) : null;
  if (rawEnd && !endMonth) errors.endMonth ??= "Invalid month.";
  const categoryId = str(fd, "categoryId");
  if (!categoryId) errors.categoryId ??= "Required field.";
  return {
    active: fd.get("active") === "on",
    name: requiredField(fd, "name", errors), dueDay, categoryId,
    startMonth: startMonth ?? new Date(0), endMonth, shared: sharedField(fd) ?? true,
  };
}

export async function createChargeAction(_: FormState, fd: FormData): Promise<FormState> {
  const { householdId } = await requireUser();
  const errors: Errors = {};
  const input = chargeFields(fd, errors);
  if (failed(errors)) return { fields: errors };
  return (await run(() => createCharge(householdId, input))) ?? done("/charges");
}

export async function updateChargeAction(_: FormState, fd: FormData): Promise<FormState> {
  const { householdId } = await requireUser();
  const errors: Errors = {};
  const input = chargeFields(fd, errors);
  if (failed(errors)) return { fields: errors };
  return (await run(() => updateCharge(householdId, str(fd, "id"), input))) ?? done("/charges");
}

export async function deleteChargeAction(_: FormState, fd: FormData): Promise<FormState> {
  const { householdId } = await requireUser();
  return (await run(() => deleteCharge(householdId, str(fd, "id")))) ?? done("/charges");
}

/** Marks a charge paid for the month: creates the actual expense (entered amount and date, paid by the user). */
export async function payChargeAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const month = parseMonth(str(fd, "month"));
  if (!month) return { error: "Invalid month." };
  const errors: Errors = {};
  const amount = amountField(fd, errors);
  const occurredOn = dayField(fd, errors);
  if (failed(errors)) return { fields: errors };
  // Allow-list: only the fixed value "calendar" changes the return page.
  return (await run(() => payCharge(user.householdId, user.id, str(fd, "id"), month, amount, occurredOn)))
    ?? done(`${str(fd, "back") === "calendar" ? "/calendar" : "/charges"}?m=${formatMonth(month)}`);
}

// --- Loans ---

/** Optional amount field: empty → `empty`; `min0` accepts 0. */
function optionalCents(fd: FormData, name: string, errors: Errors, empty: number | null, min0: boolean) {
  const raw = str(fd, name);
  if (!raw) return empty;
  const cents = parseCents(raw, { allowSigned: min0 });
  if (cents === null || cents < 0) errors[name] ??= min0 ? "Invalid amount: 0 or more (e.g. 15 or 12.50)." : AMOUNT_ERROR;
  return cents ?? 0;
}

/**
 * Simple loan (empty principal): name, first due date, number and amount of instalments → rate 0, principal = amount × number.
 * Principal entered: amortizing loan (rate required, payment computed when empty).
 */
function loanFields(fd: FormData, errors: Errors): LoanInput {
  const termMonths = Number(str(fd, "termMonths"));
  if (!Number.isInteger(termMonths) || termMonths < 1 || termMonths > 600) errors.termMonths ??= "Invalid number: between 1 and 600 instalments.";
  const payment = optionalCents(fd, "payment", errors, null, false);
  const simple = !str(fd, "principal");
  if (simple && payment === null) errors.payment ??= "Enter the amount of each instalment.";
  const principal = simple ? (payment ?? 0) * termMonths : parseCents(str(fd, "principal"));
  if (principal === null) errors.principal ??= AMOUNT_ERROR;
  // "3.45" → 3450 (thousandths of a percent); empty for a simple loan = 0
  const rate = /^(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(str(fd, "annualRate") || (simple ? "0" : ""));
  const annualRate = rate ? Number(rate[1]) * 1000 + Number((rate[2] ?? "").padEnd(3, "0")) : -1;
  if (annualRate < 0 || annualRate > 50_000) errors.annualRate ??= "Invalid rate: between 0 and 50%, at most 3 decimals (e.g. 3.45).";
  const firstDue = parseDay(str(fd, "firstDue"));
  if (!firstDue) errors.firstDue ??= "Invalid date.";
  const categoryId = str(fd, "categoryId");
  if (!categoryId) errors.categoryId ??= "Required field.";
  return {
    name: requiredField(fd, "name", errors), categoryId, firstDue: firstDue ?? new Date(0),
    principal: principal ?? 0, annualRate, termMonths,
    payment, insurance: optionalCents(fd, "insurance", errors, 0, true)!,
  };
}

export async function createLoanAction(_: FormState, fd: FormData): Promise<FormState> {
  const { householdId } = await requireUser();
  const errors: Errors = {};
  const input = loanFields(fd, errors);
  if (failed(errors)) return { fields: errors };
  let id = "";
  return (await run(async () => (id = (await createLoan(householdId, input)).id))) ?? done(`/loans/${id}`);
}

export async function updateLoanAction(_: FormState, fd: FormData): Promise<FormState> {
  const { householdId } = await requireUser();
  const id = str(fd, "id");
  const errors: Errors = {};
  const input = loanFields(fd, errors);
  if (failed(errors)) return { fields: errors };
  return (await run(() => updateLoan(householdId, id, input))) ?? done(`/loans/${id}`);
}

export async function deleteLoanAction(_: FormState, fd: FormData): Promise<FormState> {
  const { householdId } = await requireUser();
  return (await run(() => deleteLoan(householdId, str(fd, "id")))) ?? done("/loans");
}

/** Early repayment: creates the actual expense (loan category, paid by the user). */
export async function prepayLoanAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const id = str(fd, "id");
  const errors: Errors = {};
  const amount = amountField(fd, errors);
  const occurredOn = dayField(fd, errors);
  const mode = str(fd, "mode");
  if (mode !== "REDUCE_TERM" && mode !== "REDUCE_PAYMENT") errors.mode ??= "Choose a mode.";
  if (failed(errors)) return { fields: errors };
  return (await run(() => prepay(user.householdId, user.id, id, amount, occurredOn, mode as "REDUCE_TERM", idempotencyKey(fd)))) ?? done(`/loans/${id}`);
}

// --- Reports (nothing is written to the budget or transactions without an explicit click) ---

/** On-demand report (MANUAL): today's, or review of the past month; optional `provider` = one-off try, else the household preference. */
export async function analyzeAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const errors: Errors = {};
  const provider = providerField(fd, "provider", user.household, errors) ?? undefined;
  if (failed(errors)) return { fields: errors };
  const kind = str(fd, "kind") === "MONTHLY" ? "MONTHLY" : "DAILY";
  let id = "";
  return (await run(async () => (id = (await generateReport(user, kind, parseDay(todayIn(user.household.timezone))!, "MANUAL", { provider, locale: (await getI18n()).locale })).id))) ?? done(`/reports?id=${encodeURIComponent(id)}`);
}

/** Preparing a month's budget: proposed split of what's left over the variable expenses. */
export async function planAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const month = parseMonth(str(fd, "month"));
  if (!month) return { error: "Invalid month." };
  let id = "";
  return (await run(async () => (id = (await generateReport(user, "PLAN", parseDay(todayIn(user.household.timezone))!, "MANUAL", { month, locale: (await getI18n()).locale })).id))) ?? done(`/reports?id=${encodeURIComponent(id)}`);
}

export async function applyPlanAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const id = str(fd, "reportId");
  let n = 0;
  return (await run(async () => (n = await applyPlan(user, id)))) ?? done(`/reports?id=${encodeURIComponent(id)}&lines=${n}`);
}
