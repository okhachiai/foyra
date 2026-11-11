import Link from "next/link";
import type { ReactNode } from "react";
import type { CategoryKind } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { budgetSeeds, formatMonth, getBudget, groupOf, incomeLines, itemSignature, parseMonth, type Group } from "@/lib/budget";
import { spendingPlan } from "@/lib/dashboard";
import { configuredProviders } from "@/lib/llm";
import { prisma } from "@/lib/db";
import { monthLabel, todayIn } from "@/lib/ledger";
import { centsToInput, formatCents, formatWhole } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { MonthNav } from "@/components/ui/month-nav";
import { PageHeader } from "@/components/ui/page-header";
import { ProgressBar } from "@/components/ui/progress";
import { Stat } from "@/components/ui/stat";
import { budgetAction, createBudgetAction, importBudgetAction, planAction } from "@/app/actions";
import { ActionForm, Field } from "@/app/form";
import { Fold, SubFold } from "./fold";

/** Lignes prévues réparties selon le type de leur catégorie (voir groupOf) ; une ligne sans catégorie est variable. */
const SECTIONS: [Group, string][] = [
  ["income", "Revenus"],
  ["fixed", "Charges fixes"],
  ["savings", "Épargne"],
  ["variable", "Charges variables"],
];

/**
 * Colonnes d'une ligne budgétaire. Mobile : case, libellé, prévu ; réel, écart et actions passent dessous.
 * sm+ : case, libellé, prévu, réel, écart, reprise, actions — largeurs fixes, alignées malgré le retrait des sous-lignes.
 */
const COLS = "grid-cols-[1.5rem_minmax(0,1fr)_7rem] items-center gap-x-3 lg:grid-cols-[1.5rem_minmax(0,1fr)_7.5rem_7rem_6.5rem_2rem_7.25rem]";

/** Formulaire sur une ligne : le <fieldset> d'ActionForm, sans bordure, porte la mise en page. */
const ROW = "[&_fieldset]:m-0 [&_fieldset]:flex [&_fieldset]:min-w-0 [&_fieldset]:flex-wrap [&_fieldset]:items-center [&_fieldset]:gap-3 [&_fieldset]:border-0 [&_fieldset]:p-0";

type Budget = NonNullable<Awaited<ReturnType<typeof getBudget>>>;
type Line = Budget["tree"][number]["children"][number];

export default async function BudgetPage({ searchParams }: { searchParams: Promise<{ m?: string; ok?: string }> }) {
  const user = await requireUser();
  const { m, ok } = await searchParams;
  const today = todayIn(user.household.timezone);
  const month = parseMonth(m) ?? parseMonth(today.slice(0, 7))!;
  // Date proposée pour saisir le réel : aujourd'hui si le budget est celui du mois courant, sinon le 1er du mois.
  const entryDay = today.startsWith(formatMonth(month)) ? today : `${formatMonth(month)}-01`;
  const budget = await getBudget(user.householdId, month);
  const money = (cents: number) => formatCents(cents, user.household.currency);
  const label = monthLabel(month);

  /** En-tête : titre, statut (sous-titre), export du mois, sélecteur de mois et actions propres au budget. */
  const header = (subtitle: ReactNode, actions?: ReactNode) => (
    <PageHeader
      eyebrow="Foyra / Budget"
      title="Budget mensuel"
      subtitle={subtitle}
      actions={
        <>
          <a href={`/budget/export?m=${formatMonth(month)}`} download className="button ghost" aria-label="Exporter le mois"><Icon name="download" className="size-4" /><span className="max-sm:sr-only">Exporter</span></a>
          <MonthNav path="/budget" month={month} />
          {actions}
        </>
      }
    />
  );

  /** Import d'un fichier exporté (budget, opérations, paiements) : le mois du fichier est remplacé à l'identique. ADMIN seulement (touche au catalogue). */
  const transfer = user.role === "ADMIN" && (
    <ActionForm
      action={importBudgetAction}
      className={`card mt-6 p-4 ${ROW}`}
      confirm="Remplacer le budget et toutes les opérations du mois contenu dans le fichier par ceux du fichier ?"
    >
      <span className="text-label font-semibold text-heading">Importer un mois exporté</span>
      <label className="min-w-0 flex-1 basis-56">
        <span className="sr-only">Fichier de mois à importer (.json)</span>
        <input type="file" name="file" accept=".json,application/json" required className="cursor-pointer py-2 text-sm text-muted file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-raised file:px-3 file:py-1 file:text-sm file:text-heading" />
      </label>
      <button type="submit" className="secondary">Importer</button>
    </ActionForm>
  );

  if (!budget) {
    const incomes = incomeLines(await budgetSeeds(prisma, user.householdId, month));
    return (
      <>
        {header(<>Aucun budget pour {label}.</>)}
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
        {transfer}
      </>
    );
  }

  const draft = budget.status === "DRAFT";
  const { totals } = budget;
  const plan = spendingPlan(budget.tree);
  const overruns = plan.lines.filter((l) => l.left < 0);
  const used = plan.planned ? Math.round((plan.actual / plan.planned) * 100) : null;
  const round = (cents: number) => formatWhole(cents, user.household.currency);
  const signed = (cents: number) => `${cents > 0 ? "+" : ""}${money(cents)}`;

  const currency = new Intl.NumberFormat("fr-FR", { style: "currency", currency: user.household.currency }).formatToParts(0).find((x) => x.type === "currency")?.value;

  /**
   * Une ligne éditable : inclusion, libellé (+ barre réel/prévu des dépenses), montant (ou total calculé), réel, écart, reprise, ↑/↓, retrait.
   * Écart : prévu − réel pour une dépense (négatif = dépassement), réel − prévu pour un revenu.
   */
  const row = (i: Line, opts: { total?: number; child?: boolean; parentExcluded?: boolean; shared: boolean; first: boolean; last: boolean }) => {
    const p = `${i.id}:`;
    const computed = opts.total !== undefined;
    const flags = draft && !opts.child && i.kind === "EXPENSE";
    const income = i.kind === "INCOME";
    const planned = opts.total ?? i.amount;
    const gap = income ? i.actual - planned : planned - i.actual;
    return (
      <div key={i.id} className={`grid ${COLS} gap-y-1.5 border-t border-hairline py-2 [&_.field>span]:sr-only ${opts.child ? "pl-4 lg:pl-8" : ""} ${opts.parentExcluded || !i.included ? "opacity-60" : ""}`}>
        <input type="hidden" name="item" value={i.id} />
        <input type="hidden" name={`sig:${i.id}`} value={itemSignature(flags ? i : { ...i, shared: undefined, reserve: undefined })} />
        <label className="check" title="Inclure dans le budget">
          <input type="checkbox" name={`${p}included`} defaultChecked={i.included} disabled={!draft} />
          <span className="sr-only">Inclure · {i.label}</span>
        </label>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Field name={`${p}label`} label="Libellé">
            <input name={`${p}label`} defaultValue={i.label} maxLength={100} required readOnly={!draft} className={opts.child ? "" : "font-semibold"} />
          </Field>
          {!income && (planned > 0 || i.actual > 0) && <ProgressBar value={i.actual} max={planned} label={`${i.label} : part du prévu dépensée`} className="h-1" />}
        </div>
        {computed ? (
          <span className="amount px-3 text-right tabular-nums" title="Somme des sous-lignes incluses">{centsToInput(opts.total!)}</span>
        ) : (
          <Field name={`${p}amount`} label={`Montant prévu · ${i.label}`}>
            <input name={`${p}amount`} inputMode="decimal" autoComplete="off" defaultValue={centsToInput(i.amount)} readOnly={!draft} className="text-right tabular-nums" />
          </Field>
        )}
        <div className="col-[2/-1] flex flex-wrap items-center gap-x-3 text-label lg:contents">
          {i.categoryId ? (
            <Link
              href={`/operations/new?${new URLSearchParams({ kind: i.kind, cat: i.categoryId, d: entryDay, ...(opts.shared && { shared: "1" }), back: "budget" })}`}
              title={`Saisir une opération · ${i.label}`}
              className="inline-flex items-center justify-end gap-1 text-muted tabular-nums hover:text-heading"
            >
              <span className="lg:hidden">Réel</span>{money(i.actual)}<Icon name="plus" className="size-3.5" />
            </Link>
          ) : (
            <span className="text-muted tabular-nums lg:pr-[1.125rem] lg:text-right" title="Aucune catégorie : réel non suivi"><span className="lg:hidden">Réel </span>{money(i.actual)}</span>
          )}
          <span className={`tabular-nums lg:text-right ${!income && gap < 0 ? "font-semibold text-neg" : "text-muted"}`} title={income ? "Écart : réel − prévu" : gap < 0 ? "Dépassement : prévu − réel" : "Restant : prévu − réel"}>
            <span className="sr-only">Écart </span>{signed(gap)}
          </span>
          <label className="check ml-auto lg:ml-0" title="Reprendre le mois suivant">
            <input type="checkbox" name={`${p}recurring`} defaultChecked={i.recurring} disabled={!draft} />
            <span aria-hidden className="text-xs text-muted">↻</span>
            <span className="sr-only">Reprendre · {i.label}</span>
          </label>
          {draft ? (
            <span className="flex justify-end gap-1">
              <button type="submit" name="op" value={`move:up:${i.id}`} disabled={opts.first} className="ghost min-h-9 w-9 px-0 max-sm:hidden" aria-label={`Monter « ${i.label} »`}>↑</button>
              <button type="submit" name="op" value={`move:down:${i.id}`} disabled={opts.last} className="ghost min-h-9 w-9 px-0 max-sm:hidden" aria-label={`Descendre « ${i.label} »`}>↓</button>
              <button
                type="submit" name="op" value={`remove:${i.id}`} className="ghost min-h-9 w-9 px-0 hover:text-neg" aria-label={`Retirer « ${i.label} »`}
                data-confirm={computed ? `Retirer « ${i.label} » et ses sous-lignes ?` : `Retirer « ${i.label} » ?`}
              >
                ×
              </button>
            </span>
          ) : (
            <span className="hidden lg:block" />
          )}
        </div>
      </div>
    );
  };

  /** Cases « Commune » / « Réserve » : lignes principales de dépense, en brouillon seulement (affichées sur la ligne du dépli). */
  const flagsOf = (i: Line) =>
    draft && i.kind === "EXPENSE" && (
      <span className="flex gap-x-4">
        <input type="hidden" name={`${i.id}:flags`} value="1" />
        <label className="check min-h-8 font-medium" title="Dépense commune, partagée au prorata des revenus">
          <input type="checkbox" name={`${i.id}:shared`} defaultChecked={i.shared} className="size-4!" />
          <span>Commune<span className="sr-only"> · {i.label}</span></span>
        </label>
        <label className="check min-h-8 font-medium" title="Réserve imprévus : absorbe les dépassements des enveloppes">
          <input type="checkbox" name={`${i.id}:reserve`} defaultChecked={i.reserve} className="size-4!" />
          <span>Réserve<span className="sr-only"> · {i.label}</span></span>
        </label>
      </span>
    );

  /** Champs d'ajout d'une ligne (`target` = type ou ligne parente). */
  const adder = (target: string, text: string) => (
    <div className="grid grid-cols-[minmax(0,1fr)_7rem] items-end gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_auto] [&_.field>span]:sr-only">
      <Field name={`new:${target}:label`} label={`Libellé · ${text}`}>
        <input name={`new:${target}:label`} maxLength={100} placeholder={text} autoComplete="off" />
      </Field>
      <Field name={`new:${target}:amount`} label={`Montant · ${text}`}>
        <input name={`new:${target}:amount`} inputMode="decimal" placeholder="0,00" autoComplete="off" className="text-right" />
      </Field>
      <button type="submit" name="op" value={`add:${target}`} className="secondary col-span-2 sm:col-span-1"><Icon name="plus" className="size-4" />Ajouter</button>
    </div>
  );

  /** En-tête de colonnes (sm+ seulement : sur mobile, chaque valeur porte son libellé). */
  const columns = (
    <div aria-hidden className={`hidden ${COLS} pb-1 text-micro font-semibold uppercase tracking-wide text-faint lg:grid`}>
      <span />
      <span>Libellé</span>
      <span className="pr-3 text-right">Prévu ({currency})</span>
      <span className="pr-[1.125rem] text-right">Réel</span>
      <span className="text-right">Écart</span>
      <span title="Reprise le mois suivant">↻</span>
      <span />
    </div>
  );

  /** Section du formulaire : lignes prévues d'un groupe (voir SECTIONS), sous-catégories repliables. */
  const section = ([group, title]: [Group, string]) => {
    const kind: CategoryKind = group === "income" ? "INCOME" : "EXPENSE";
    const nodes = budget.tree.filter((n) => groupOf(n) === group);
    const total = totals[group];
    const actual = nodes.reduce((s, n) => s + (n.included ? n.actual : 0), 0);
    return (
      <Fold
        key={title}
        title={title}
        aside={
          <span className="self-center text-label text-muted tabular-nums">
            Réel <b className="text-heading">{money(actual)}</b> / <b className="text-heading">{money(total)}</b>
          </span>
        }
      >
        {nodes.length === 0 ? (
          <p className="m-0 text-sm text-muted">
            {/* Seule l'épargne peut avoir un total sans ligne : elle compte aussi les versements du mois. */}
            {total > 0 ? `Aucune ligne prévue, ${money(total)} déjà versés ce mois.` : "Aucune ligne."}
          </p>
        ) : (
          <div>
            {columns}
            {nodes.map((n, k) => (
              <div key={n.id}>
                {row(n, { total: n.children.length ? n.total : undefined, shared: n.shared, first: k === 0, last: k === nodes.length - 1 })}
                {(n.children.length > 0 || draft) && (
                  <SubFold
                    id={n.categoryId ?? n.label}
                    summary={
                      n.children.length ? (
                        <>{n.children.length}<span className="max-sm:hidden"> sous-catégorie{n.children.length > 1 && "s"}</span><span className="sm:hidden"> sous-cat.</span></>
                      ) : (
                        <><span className="max-sm:hidden">Ajouter une sous-catégorie</span><span className="sm:hidden">+ sous-cat.</span></>
                      )
                    }
                    aside={flagsOf(n)}
                  >
                    {n.children.map((c, j) => row(c, { child: true, parentExcluded: !n.included, shared: n.shared, first: j === 0, last: j === n.children.length - 1 }))}
                    {draft && <div className="py-2 pl-4 sm:pl-8">{adder(n.id, `Nouvelle sous-catégorie de « ${n.label} »`)}</div>}
                  </SubFold>
                )}
              </div>
            ))}
          </div>
        )}
        {/* Une nouvelle ligne n'a pas de catégorie : elle rejoint les charges variables. */}
        {draft && (group === "income" || group === "variable") && <div className="border-t border-hairline pt-3">{adder(kind, kind === "INCOME" ? "Nouvelle ligne de revenu" : "Nouvelle ligne de dépense")}</div>}
      </Fold>
    );
  };

  return (
    <>
      {header(
        <span className="inline-flex flex-wrap items-center gap-2">
          <Badge dot tone={draft ? "warning" : "success"}>{draft ? "Brouillon" : "Validé"}</Badge>
          {label.replace(/^./, (c) => c.toUpperCase())} · {draft ? "lignes modifiables jusqu'à validation" : "lignes en lecture seule"}
        </span>,
        <ActionForm action={budgetAction} className="inline">
          <input type="hidden" name="month" value={formatMonth(month)} />
          <input type="hidden" name="budgetId" value={budget.id} />
          {draft ? (
            <button type="submit" name="op" value="status:VALIDATED">Valider le budget</button>
          ) : (
            <button type="submit" name="op" value="status:DRAFT" className="secondary border-warn/40 text-warn">Repasser en brouillon</button>
          )}
        </ActionForm>,
      )}
      {ok && <p role="status" className="alert success mb-4"><Icon name="shield" className="mt-0.5 size-4 shrink-0" />Budget enregistré.</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Revenus prévus" value={round(totals.income)} />
        <Stat label="Dépenses prévues" value={round(totals.fixed + totals.variable)} note={`Fixes ${round(totals.fixed)} · var. ${round(totals.variable)}`} />
        <Stat label="Épargne prévue" value={round(totals.savings)} />
        <Stat label="Reste prévisionnel" value={round(totals.remaining)} tone={totals.remaining < 0 ? "neg" : undefined} note="Revenus − dépenses − épargne" />
      </div>

      <Card className="mt-4">
        <SectionHeader
          title="Suivi des dépenses"
          subtitle="Réel / prévu, charges fixes et variables incluses"
          action={used !== null && <Badge tone={used > 100 ? "danger" : used > 90 ? "warning" : "success"}>{used} % consommé</Badge>}
        />
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-label text-muted">
          <span><b className="text-section text-heading tabular-nums">{money(plan.actual)}</b> dépensés sur {money(plan.planned)}</span>
          <b className={`tabular-nums ${plan.left < 0 ? "text-neg" : "text-heading"}`}>{plan.left < 0 ? `Dépassé de ${money(-plan.left)}` : `${money(plan.left)} restants`}</b>
        </div>
        <ProgressBar value={plan.actual} max={plan.planned} label="Dépenses réelles sur prévues" />
        {overruns.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-label font-semibold text-neg">{overruns.length} dépassement{overruns.length > 1 ? "s" : ""}</span>
            {overruns.map((l) => <Badge key={l.id} tone="danger">{l.label} · +{money(-l.left)}</Badge>)}
          </div>
        )}
      </Card>

      {draft && configuredProviders(user.household).length > 0 && (
        <ActionForm action={planAction} className={`card mt-4 p-4 ${ROW} [&_fieldset]:justify-between`} pendingNotice="L'IA prépare la répartition… cela peut prendre quelques minutes avec un modèle local.">
          <input type="hidden" name="month" value={formatMonth(month)} />
          <p className="m-0 min-w-0 flex-1 basis-64 text-sm text-muted">
            Revenus, charges fixes et épargne saisis ? L'IA répartit les {money(Math.max(totals.income - totals.fixed - totals.savings, 0))} restants sur les charges variables.
          </p>
          <button type="submit" className="secondary"><Icon name="reports" className="size-4" />Proposer la répartition</button>
        </ActionForm>
      )}

      {/* Clé neuve à chaque rendu serveur : après un enregistrement réussi, les champs repartent des valeurs en base. */}
      <ActionForm action={budgetAction} key={crypto.randomUUID()} className="mt-4 [&>fieldset]:m-0 [&>fieldset]:flex [&>fieldset]:min-w-0 [&>fieldset]:flex-col [&>fieldset]:gap-4 [&>fieldset]:border-0 [&>fieldset]:p-0">
        {/* Bouton par défaut (touche Entrée) : enregistrer. */}
        {draft && <button type="submit" name="op" value="save" hidden tabIndex={-1} aria-hidden />}
        <input type="hidden" name="month" value={formatMonth(month)} />
        <input type="hidden" name="budgetId" value={budget.id} />
        {SECTIONS.map(section)}
        {draft && <button type="submit" name="op" value="save" className="self-start">Enregistrer le budget</button>}
      </ActionForm>
      {transfer}
    </>
  );
}
