import Link from "next/link";
import type { CategoryKind } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { addMonths } from "@/lib/amortization";
import { actualTotals, budgetSeeds, envelopes, formatMonth, getBudget, groupOf, incomeLines, itemSignature, parseMonth, type Group } from "@/lib/budget";
import { listMonthCharges } from "@/lib/charges";
import { configuredProviders } from "@/lib/llm";
import { prisma } from "@/lib/db";
import { formatDay, todayIn } from "@/lib/ledger";
import { centsToInput, formatCents } from "@/lib/money";
import { getSplit } from "@/lib/split";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Stat } from "@/components/ui/stat";
import { budgetAction, createBudgetAction, planAction } from "@/app/actions";
import { ActionForm, Field } from "@/app/form";
import { Fold } from "./fold";

const percent = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 2 });
const monthLabel = (month: Date) => new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(month);
/** Lignes prévues réparties selon le type de leur catégorie (voir groupOf) ; une ligne sans catégorie est variable. */
const SECTIONS: [Group, string][] = [
  ["income", "Revenus"],
  ["fixed", "Catégories de charges fixes"],
  ["savings", "Épargne"],
  ["variable", "Catégories de charges variables"],
];

type Budget = NonNullable<Awaited<ReturnType<typeof getBudget>>>;
type Line = Budget["tree"][number]["children"][number];

export default async function BudgetPage({ searchParams }: { searchParams: Promise<{ m?: string; ok?: string }> }) {
  const user = await requireUser();
  const { m, ok } = await searchParams;
  const today = todayIn(user.household.timezone);
  const month = parseMonth(m) ?? parseMonth(today.slice(0, 7))!;
  // Date proposée pour saisir le réel : aujourd'hui si le budget est celui du mois courant, sinon le 1er du mois.
  const entryDay = today.startsWith(formatMonth(month)) ? today : `${formatMonth(month)}-01`;
  const [budget, charges, actual] = await Promise.all([getBudget(user.householdId, month), listMonthCharges(user.householdId, month), actualTotals(user.householdId, month)]);
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
    const incomes = incomeLines(await budgetSeeds(prisma, user.householdId, month));
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
          Tous les montants prévus se saisissent ici : ils alimentent le tableau de bord, les récurrences et le partage. Le budget est prévisionnel : il ne crée aucune opération.
        </EmptyState>
      </>
    );
  }

  const draft = budget.status === "DRAFT";
  const { totals } = budget;
  // Partage : utile à partir de deux membres.
  const split = await getSplit(user.householdId, month).then((s) => (s.members.length > 1 ? s : null));
  const env = envelopes(budget.tree);
  // Charges fixes et crédits du mois, calculés en direct : un crédit soldé n'apparaît plus.
  const expenses = charges.filter((c) => c.kind === "EXPENSE");
  const fixed = expenses.filter((c) => !c.loanId), loans = expenses.filter((c) => c.loanId);
  const sum = (l: typeof expenses) => l.reduce((s, c) => s + c.amount, 0);
  const fixedTotal = sum(fixed), loanTotal = sum(loans);

  const currency = new Intl.NumberFormat("fr-FR", { style: "currency", currency: user.household.currency }).formatToParts(0).find((x) => x.type === "currency")?.value;

  /**
   * Une ligne éditable : inclusion, libellé, montant (ou total calculé), réel, reprise, ↑/↓, retrait.
   * Colonnes de largeur fixe à droite : elles restent alignées quel que soit le retrait des sous-lignes.
   */
  const row = (i: Line, opts: { total?: number; child?: boolean; parentExcluded?: boolean; shared: boolean; first: boolean; last: boolean }) => {
    const p = `${i.id}:`;
    const computed = opts.total !== undefined;
    // Cases « Commune » / « Réserve » : lignes principales de dépense, en brouillon seulement.
    const flags = draft && !opts.child && i.kind === "EXPENSE";
    return (
      <div key={i.id} className={`grid grid-cols-[1.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 border-t border-hairline py-2 sm:grid-cols-[1.5rem_minmax(0,1fr)_8rem_1rem_7rem_1.75rem_4.75rem_2.75rem] [&_.field>span]:sr-only ${opts.child ? "pl-4 sm:pl-8" : ""} ${opts.parentExcluded || !i.included ? "opacity-60" : ""}`}>
        <input type="hidden" name="item" value={i.id} />
        <input type="hidden" name={`sig:${i.id}`} value={itemSignature(flags ? i : { ...i, shared: undefined, reserve: undefined })} />
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
          {i.categoryId ? (
            <Link
              href={`/operations/new?${new URLSearchParams({ kind: i.kind, cat: i.categoryId, d: entryDay, ...(opts.shared && { shared: "1" }), back: "budget" })}`}
              title={`Saisir une opération · ${i.label}`}
              className="text-right text-xs text-muted tabular-nums"
            >
              Réel {money(i.actual)} +
            </Link>
          ) : (
            <small className="text-right text-xs text-muted tabular-nums" title="Aucune catégorie : réel non suivi">Réel {money(i.actual)}</small>
          )}
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
        {flags && (
          <div className="col-start-2 flex flex-wrap gap-4 text-sm">
            <input type="hidden" name={`${p}flags`} value="1" />
            <label className="check" title="Dépense commune, partagée au prorata des revenus">
              <input type="checkbox" name={`${p}shared`} defaultChecked={i.shared} />
              <span>Commune<span className="sr-only"> · {i.label}</span></span>
            </label>
            <label className="check" title="Réserve imprévus : absorbe les dépassements des enveloppes">
              <input type="checkbox" name={`${p}reserve`} defaultChecked={i.reserve} />
              <span>Réserve<span className="sr-only"> · {i.label}</span></span>
            </label>
          </div>
        )}
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

  /** Section du formulaire : lignes prévues d'un groupe (voir SECTIONS). */
  const section = ([group, title]: [Group, string]) => {
    const kind: CategoryKind = group === "income" ? "INCOME" : "EXPENSE";
    const nodes = budget.tree.filter((n) => groupOf(n) === group);
    const total = totals[group];
    return (
      <Fold key={title} title={title} aside={<span className="amount">{money(total)}</span>}>
        {nodes.length === 0 && (
          <p className="m-0 text-sm text-muted">
            {/* Seule l'épargne peut avoir un total sans ligne : elle compte aussi les versements du mois. */}
            {total > 0 ? `Aucune ligne prévue, ${money(total)} déjà versés ce mois.` : "Aucune ligne."}
          </p>
        )}
        <div>
          {nodes.map((n, k) => (
            <div key={n.id}>
              {row(n, { total: n.children.length ? n.total : undefined, shared: n.shared, first: k === 0, last: k === nodes.length - 1 })}
              {n.children.map((c, j) => row(c, { child: true, parentExcluded: !n.included, shared: n.shared, first: j === 0, last: j === n.children.length - 1 }))}
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
        {draft && (group === "income" || group === "variable") && <div className="border-t border-hairline pt-3">{adder(kind, kind === "INCOME" ? "Nouvelle ligne de revenu" : "Nouvelle ligne de dépense")}</div>}
      </Fold>
    );
  };

  return (
    <>
      {pager}
      <ActionForm action={budgetAction} className="mb-4 flex justify-end [&_fieldset]:m-0 [&_fieldset]:border-0 [&_fieldset]:p-0 [&_fieldset]:flex [&_fieldset]:flex-wrap [&_fieldset]:items-center [&_fieldset]:justify-end [&_fieldset]:gap-3">
        <input type="hidden" name="month" value={formatMonth(month)} />
        <input type="hidden" name="budgetId" value={budget.id} />
        <Badge tone={draft ? "warning" : "success"}>{draft ? "Brouillon" : "Validé"}</Badge>
        {draft ? (
          <button type="submit" name="op" value="status:VALIDATED" className="border-pos bg-pos text-accent-text">Valider le budget</button>
        ) : (
          <>
            <button type="submit" name="op" value="status:DRAFT" className="secondary border-warn/40 text-warn">Repasser en brouillon</button>
            <small className="text-muted">Budget validé : lignes en lecture seule.</small>
          </>
        )}
      </ActionForm>
      {ok && <p role="status" className="text-pos">Budget enregistré.</p>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label="Total des revenus" value={money(totals.income)} note={`Réel ${money(actual.income)}`} />
        <Stat label="Charges fixes" value={money(totals.fixed)} note={`Réel ${money(actual.fixed)}`} />
        <Stat label="Charges variables" value={money(totals.variable)} note={`Réel ${money(actual.variable)}`} />
        <Stat label="Épargne" value={money(totals.savings)} note={`Prévu, ou versé s’il est plus élevé · réel ${money(actual.savings)}`} />
        <Stat label="Reste prévisionnel" value={money(totals.remaining)} tone={totals.remaining < 0 ? "neg" : undefined} note="Revenus − fixes − variables − épargne" />
        <Stat label="Reste réel" value={money(actual.remaining)} tone={actual.remaining < 0 ? "neg" : undefined} note="Mêmes calculs sur les opérations enregistrées du mois" />
      </div>

      {draft && configuredProviders(user.household).length > 0 && (
        <ActionForm action={planAction} className="card mt-4 flex flex-wrap items-center justify-between gap-3" pendingNotice="L'IA prépare la répartition… cela peut prendre quelques minutes avec un modèle local.">
          <input type="hidden" name="month" value={formatMonth(month)} />
          <p className="m-0 text-sm text-muted">
            Revenus, charges fixes et épargne saisis ? L'IA répartit les {money(Math.max(totals.income - totals.fixed - totals.savings, 0))} restants sur les charges variables.
          </p>
          <button type="submit" className="secondary">Proposer la répartition</button>
        </ActionForm>
      )}

      {split && (
        <Fold className="mt-4" title="Partage" aside={<span className="amount" title="Dépenses communes prévues, moins les recettes communes">{money(split.commonNet)}</span>}>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm tabular-nums">
              <thead>
                <tr className="text-left text-muted">
                  <th className="py-2 pr-3 font-medium">Membre</th>
                  <th className="py-2 pr-3 text-right font-medium">Revenu</th>
                  <th className="py-2 pr-3 text-right font-medium">Part</th>
                  <th className="py-2 pr-3 text-right font-medium">Dû</th>
                  <th className="py-2 pr-3 text-right font-medium">Communes payées</th>
                  <th className="py-2 pr-3 text-right font-medium">Reste à verser</th>
                  <th className="py-2 text-right font-medium">Reste perso</th>
                </tr>
              </thead>
              <tbody>
                {split.members.map((m) => (
                  <tr key={m.userId} className="border-t border-hairline">
                    <td className="py-2 pr-3">{m.name}</td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap">
                      {money(m.income)}
                    </td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap">{percent.format(m.shareBp / 10000)}</td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap">{money(m.due)}</td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap">{money(m.contribution)}</td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap text-heading">
                      {m.toTransfer < 0 ? <>à recevoir {money(-m.toTransfer)}</> : money(m.toTransfer)}
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">{money(m.personalLeft)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Fold>
      )}

      {/* Clé neuve à chaque rendu serveur : après un enregistrement réussi, les champs repartent des valeurs en base. */}
      <ActionForm action={budgetAction} key={crypto.randomUUID()} className="form mt-4">
        {/* Bouton par défaut (touche Entrée) : enregistrer. */}
        {draft && <button type="submit" name="op" value="save" hidden tabIndex={-1} aria-hidden />}
        <input type="hidden" name="month" value={formatMonth(month)} />
        <input type="hidden" name="budgetId" value={budget.id} />
        {section(SECTIONS.find(([group]) => group === "savings")!)}
        {(env.lines.length > 0 || env.reserve) && (
          <Fold title="Enveloppes">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm tabular-nums">
                <thead>
                  <tr className="text-left text-muted">
                    <th className="py-2 pr-3 font-medium">Libellé</th>
                    <th className="py-2 pr-3 text-right font-medium">Prévu</th>
                    <th className="py-2 pr-3 text-right font-medium">Réel</th>
                    <th className="py-2 text-right font-medium">Restant</th>
                  </tr>
                </thead>
                <tbody>
                  {[...env.lines, ...(env.reserve ? [env.reserve] : [])].map((e) => (
                    <tr key={e.id} className="border-t border-hairline">
                      <td className="py-2 pr-3 break-words">
                        {e.label}
                        {e === env.reserve && <small className="block text-xs text-muted">Réserve · dont {money(env.reserve.overrun)} de dépassements absorbés</small>}
                      </td>
                      <td className="py-2 pr-3 text-right whitespace-nowrap">{money(e.planned)}</td>
                      <td className="py-2 pr-3 text-right whitespace-nowrap">{money(e.actual)}</td>
                      <td className={`py-2 text-right whitespace-nowrap ${e.left < 0 ? "text-neg" : "text-heading"}`}>{money(e.left)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Fold>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <Fold title="Échéances du mois" aside={<span className="amount">{money(fixedTotal)}</span>}>
            {fixed.length === 0 && <p className="m-0 text-sm text-muted">Aucune charge fixe ce mois-ci.</p>}
            {fixed.map((c) => (
              <Link key={c.id} href={`/charges/${c.id}`} className="flex justify-between gap-3 border-t border-hairline py-2">
                <span>{c.name} <small className="text-muted">· le {c.due.getUTCDate()}{!c.budgeted && " · absente du budget"}</small></span>
                <span className="amount">{money(c.amount)}</span>
              </Link>
            ))}
          </Fold>
          <Fold title="Crédits en cours" aside={<span className="amount">{money(loanTotal)}</span>}>
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
          </Fold>
        </div>

        {SECTIONS.filter(([group]) => group !== "savings").map(section)}
        {draft && <button type="submit" name="op" value="save" className="self-start">Enregistrer le budget</button>}
      </ActionForm>
    </>
  );
}
