import Link from "next/link";
import type { CategoryKind } from "@prisma/client";
import { getScope } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { addMonths, budgetSeeds, formatMonth, getBudget, incomeLines, mergeIncomes, parseMonth } from "@/lib/budget";
import { listMonthCharges } from "@/lib/charges";
import { prisma } from "@/lib/db";
import { formatDay, todayIn } from "@/lib/ledger";
import { centsToInput, formatCents } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Stat } from "@/components/ui/stat";
import { budgetAction, createBudgetAction } from "../actions";
import { ActionForm, Field } from "../form";
import { itemSignature } from "./signature";

const monthLabel = (month: Date) => new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(month);
/** Dépenses prévues réparties selon le type de leur catégorie ; une ligne sans catégorie est variable. */
const SECTIONS: [CategoryKind, string, fixed?: boolean][] = [
  ["INCOME", "Revenus"],
  ["EXPENSE", "Catégories de charges fixes", true],
  ["EXPENSE", "Catégories de charges variables", false],
];

type Budget = NonNullable<Awaited<ReturnType<typeof getBudget>>>;
type Line = Budget["tree"][number]["children"][number];

export default async function BudgetPage({ searchParams }: { searchParams: Promise<{ m?: string; ok?: string }> }) {
  const user = await requireUser();
  const { m, ok } = await searchParams;
  const month = parseMonth(m) ?? parseMonth(todayIn(user.household.timezone).slice(0, 7))!;
  const scope = await getScope(user);
  const [budget, charges] = await Promise.all([getBudget(scope, month), listMonthCharges(scope, month)]);
  const money = (cents: number) => formatCents(cents, user.household.currency);
  const label = monthLabel(month);

  const pager = (
    <nav className="pager" aria-label="Mois">
      <Link href={`/budget?m=${formatMonth(addMonths(month, -1))}`}>← Mois précédent</Link>
      <h1>Budget · {label}</h1>
      <Link href={`/budget?m=${formatMonth(addMonths(month, 1))}`}>Mois suivant →</Link>
    </nav>
  );

  if (!budget) {
    const incomes = mergeIncomes(incomeLines(await budgetSeeds(prisma, user.householdId, month)), charges.filter((c) => c.kind === "INCOME"));
    return (
      <>
        {pager}
        <EmptyState
          className="card"
          title={`Aucun budget pour ${label}`}
          action={
            <ActionForm action={createBudgetAction}>
              <input type="hidden" name="month" value={formatMonth(month)} />
              <fieldset className="grid gap-2 border-0 p-0 [&_.field>span]:sr-only">
                <legend className="mb-2 font-medium">Revenus de {label}</legend>
                {[...incomes, ...Array(2).fill({ label: "", amount: 0, categoryId: null })].map((i, k) => (
                  <div key={k} className="grid grid-cols-[minmax(0,1fr)_8rem] gap-2">
                    <input type="hidden" name="inc:cat" value={i.categoryId ?? ""} />
                    <Field name={`inc:label:${k}`} label="Libellé du revenu">
                      <input name="inc:label" defaultValue={i.label} maxLength={100} placeholder="Autre revenu" autoComplete="off" />
                    </Field>
                    <Field name={`inc:amount:${k}`} label={`Montant · ${i.label || "autre revenu"}`}>
                      <input name="inc:amount" inputMode="decimal" defaultValue={i.amount ? centsToInput(i.amount) : ""} placeholder="0,00" autoComplete="off" className="text-right tabular-nums" />
                    </Field>
                  </div>
                ))}
              </fieldset>
              <button type="submit">Créer le budget de {label}</button>
            </ActionForm>
          }
        >
          {user.household.budgetSource === "PREVIOUS"
            ? "Il reprendra les lignes récurrentes du dernier budget (ou, à défaut, les modèles de catégories)."
            : "Il partira des modèles de catégories."}{" "}
          Les revenus fixes sont pré-remplis ; les charges fixes et les crédits en cours s’ajoutent automatiquement. Le budget est prévisionnel : il ne crée aucune opération et ne modifie aucun solde.
        </EmptyState>
      </>
    );
  }

  const draft = budget.status === "DRAFT";
  const { totals } = budget;
  // Charges fixes et crédits du mois, calculés en direct : un crédit soldé n'apparaît plus.
  const expenses = charges.filter((c) => c.kind === "EXPENSE");
  const fixed = expenses.filter((c) => !c.loanId), loans = expenses.filter((c) => c.loanId);
  const sum = (l: typeof expenses) => l.reduce((s, c) => s + c.amount, 0);
  const fixedTotal = sum(fixed), loanTotal = sum(loans);
  const afterFixed = totals.income - fixedTotal - loanTotal;

  const currency = new Intl.NumberFormat("fr-FR", { style: "currency", currency: user.household.currency }).formatToParts(0).find((x) => x.type === "currency")?.value;

  /**
   * Une ligne éditable : inclusion, libellé, montant (ou total calculé), réel, reprise, ↑/↓, retrait.
   * Colonnes de largeur fixe à droite : elles restent alignées quel que soit le retrait des sous-lignes.
   */
  const row = (i: Line, opts: { total?: number; child?: boolean; parentExcluded?: boolean; first: boolean; last: boolean }) => {
    const p = `${i.id}:`;
    const computed = opts.total !== undefined;
    return (
      <div key={i.id} className={`grid grid-cols-[1.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 border-t border-hairline py-2 sm:grid-cols-[1.5rem_minmax(0,1fr)_8rem_1rem_7rem_1.75rem_4.75rem_2.75rem] [&_.field>span]:sr-only ${opts.child ? "pl-4 sm:pl-8" : ""} ${opts.parentExcluded || !i.included ? "opacity-60" : ""}`}>
        <input type="hidden" name="item" value={i.id} />
        <input type="hidden" name={`sig:${i.id}`} value={itemSignature(i)} />
        <label className="check" title="Inclure dans le budget">
          <input type="checkbox" name={`${p}included`} defaultChecked={i.included} disabled={!draft} />
          <span className="sr-only">Inclure · {i.label}</span>
        </label>
        <Field name={`${p}label`} label="Libellé">
          <input name={`${p}label`} defaultValue={i.label} maxLength={100} required readOnly={!draft} className={opts.child ? "" : "font-medium"} />
        </Field>
        <div className="col-start-2 flex flex-wrap items-center gap-3 sm:contents">
          {computed ? (
            <span className="amount w-32 px-3 text-right sm:w-auto" title="Somme des sous-lignes incluses">{centsToInput(opts.total!)}</span>
          ) : (
            <span className="w-32 sm:w-auto">
              <Field name={`${p}amount`} label={`Montant prévu · ${i.label}`}>
                <input name={`${p}amount`} inputMode="decimal" autoComplete="off" defaultValue={centsToInput(i.amount)} readOnly={!draft} className="text-right tabular-nums" />
              </Field>
            </span>
          )}
          <span aria-hidden>{currency}</span>
          <small className="text-right text-xs text-muted tabular-nums">Réel {money(i.actual)}</small>
          <label className="check" title="Reprendre le mois suivant">
            <input type="checkbox" name={`${p}recurring`} defaultChecked={i.recurring} disabled={!draft} />
            <span aria-hidden className="text-xs text-muted">↻</span>
            <span className="sr-only">Reprendre · {i.label}</span>
          </label>
          {draft && (
            <>
              <span className="flex gap-1">
                <button type="submit" name="op" value={`move:up:${i.id}`} disabled={opts.first} className="secondary min-h-9 w-9 px-0" aria-label={`Monter « ${i.label} »`}>↑</button>
                <button type="submit" name="op" value={`move:down:${i.id}`} disabled={opts.last} className="secondary min-h-9 w-9 px-0" aria-label={`Descendre « ${i.label} »`}>↓</button>
              </span>
              <button
                type="submit" name="op" value={`remove:${i.id}`} className="secondary min-h-9 w-11 px-0" aria-label={`Retirer « ${i.label} »`}
                data-confirm={computed ? `Retirer « ${i.label} » et ses sous-lignes ?` : `Retirer « ${i.label} » ?`}
              >
                ×
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  /** Champs d'ajout d'une ligne (`target` = type ou ligne parente). */
  const adder = (target: string, text: string) => (
    <div className="grid grid-cols-[minmax(0,1fr)_7rem] items-end gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_auto] [&_.field>span]:sr-only">
      <Field name={`new:${target}:label`} label={`Libellé · ${text}`}>
        <input name={`new:${target}:label`} maxLength={100} placeholder={text} autoComplete="off" />
      </Field>
      <Field name={`new:${target}:amount`} label={`Montant · ${text}`}>
        <input name={`new:${target}:amount`} inputMode="decimal" placeholder="0,00" autoComplete="off" className="text-right" />
      </Field>
      <button type="submit" name="op" value={`add:${target}`} className="secondary col-span-2 sm:col-span-1">Ajouter</button>
    </div>
  );

  return (
    <>
      {pager}
      {ok && <p role="status" className="text-pos">Budget enregistré.</p>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total des revenus" value={money(totals.income)} />
        <Stat label="Charges fixes" value={money(fixedTotal)} />
        <Stat label="Crédits" value={money(loanTotal)} />
        <Stat
          label="Reste après charges et crédits" value={money(afterFixed)} tone={afterFixed < 0 ? "neg" : undefined}
          note={totals.expense ? `${money(afterFixed - totals.expense)} après les autres dépenses prévues` : undefined}
        />
      </div>

      <div className="my-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Charges fixes</CardTitle>
            <span className="amount">{money(fixedTotal)}</span>
          </CardHeader>
          {fixed.length === 0 && <p className="m-0 text-sm text-muted">Aucune charge fixe ce mois-ci.</p>}
          {fixed.map((c) => (
            <Link key={c.id} href={`/charges/${c.id}`} className="flex justify-between gap-3 border-t border-hairline py-2">
              <span>{c.name} <small className="text-muted">· le {c.due.getUTCDate()}</small></span>
              <span className="amount">{money(c.amount)}</span>
            </Link>
          ))}
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Crédits en cours</CardTitle>
            <span className="amount">{money(loanTotal)}</span>
          </CardHeader>
          {loans.length === 0 && <p className="m-0 text-sm text-muted">Aucun crédit en cours ce mois-ci.</p>}
          {loans.map((c) => (
            <Link key={c.id} href={`/credits/${c.loanId}`} className="flex justify-between gap-3 border-t border-hairline py-2">
              <span>
                {c.name}
                {c.installment && (
                  <small className="block text-muted">
                    1ʳᵉ échéance {formatDay(c.installment.firstDue).split("-").reverse().join("/")} · échéance {c.installment.n}/{c.installment.of}
                    {c.installment.n === c.installment.of && " · dernière"}
                  </small>
                )}
              </span>
              <span className="amount">{money(c.amount)}</span>
            </Link>
          ))}
        </Card>
      </div>

      <ActionForm action={budgetAction} className="my-4 flex flex-wrap items-center gap-3 [&_fieldset]:flex [&_fieldset]:flex-wrap [&_fieldset]:items-center [&_fieldset]:gap-3">
        <input type="hidden" name="month" value={formatMonth(month)} />
        <input type="hidden" name="budgetId" value={budget.id} />
        <Badge tone={draft ? "muted" : "success"}>{draft ? "Brouillon" : "Validé"}</Badge>
        {draft ? (
          <button type="submit" name="op" value="status:VALIDATED" className="secondary">Valider le budget</button>
        ) : (
          <>
            <button type="submit" name="op" value="status:DRAFT" className="secondary">Repasser en brouillon</button>
            <small className="text-muted">Budget validé : lignes en lecture seule.</small>
          </>
        )}
      </ActionForm>

      {/* Clé neuve à chaque rendu serveur : après un enregistrement réussi, les champs repartent des valeurs en base. */}
      <ActionForm action={budgetAction} key={crypto.randomUUID()}>
        {/* Bouton par défaut (touche Entrée) : enregistrer. */}
        {draft && <button type="submit" name="op" value="save" hidden tabIndex={-1} aria-hidden />}
        <input type="hidden" name="month" value={formatMonth(month)} />
        <input type="hidden" name="budgetId" value={budget.id} />
        {SECTIONS.map(([kind, title, fixed]) => {
          const nodes = budget.tree.filter((n) => n.kind === kind && (fixed === undefined || !!n.category?.fixed === fixed));
          const total = kind === "INCOME" ? totals.income : fixed ? totals.fixed : totals.variable;
          return (
            <Card key={title}>
              <CardHeader>
                <CardTitle>{title}</CardTitle>
                <span className="amount">{money(total)}</span>
              </CardHeader>
              {nodes.length === 0 && <p className="m-0 text-sm text-muted">Aucune ligne.</p>}
              <div>
                {nodes.map((n, k) => (
                  <div key={n.id}>
                    {row(n, { total: n.children.length ? n.total : undefined, first: k === 0, last: k === nodes.length - 1 })}
                    {n.children.map((c, j) => row(c, { child: true, parentExcluded: !n.included, first: j === 0, last: j === n.children.length - 1 }))}
                    {draft && (
                      <details className="mt-0 pb-2 pl-4 sm:pl-8">
                        <summary className="mb-2 text-sm">Ajouter une sous-catégorie à « {n.label} »</summary>
                        {adder(n.id, "Nouvelle sous-catégorie")}
                      </details>
                    )}
                  </div>
                ))}
              </div>
              {/* Une nouvelle ligne n'a pas de catégorie : elle rejoint les charges variables. */}
              {draft && !fixed && <div className="border-t border-hairline pt-3">{adder(kind, kind === "INCOME" ? "Nouvelle ligne de revenu" : "Nouvelle ligne de dépense")}</div>}
            </Card>
          );
        })}
        {draft && <button type="submit" name="op" value="save" className="self-start">Enregistrer le budget</button>}
      </ActionForm>
    </>
  );
}
