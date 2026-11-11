import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { addMonths } from "@/lib/amortization";
import { formatMonth, parseMonth } from "@/lib/budget";
import { listCategories } from "@/lib/categories";
import { prisma } from "@/lib/db";
import { frDate, monthLabel, monthNet, payers, todayIn } from "@/lib/ledger";
import { formatCents } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { MonthNav } from "@/components/ui/month-nav";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { Fold } from "../budget/fold";
import { EntryForm } from "./entry-form";

const dayLabel = (d: Date) => frDate({ weekday: "short", day: "numeric", month: "short" }).format(d);

type Params = { m?: string; t?: string; c?: string };

/** Opérations réelles d'un mois (`?m=AAAA-MM`, mois courant par défaut), filtrables par sens (`t`) et catégorie principale (`c`). */
export default async function OperationsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requireUser();
  const q = await searchParams;
  const todayStr = todayIn(user.household.timezone);
  const month = parseMonth(q.m) ?? parseMonth(todayStr.slice(0, 7))!;
  const m = formatMonth(month);
  const [net, rows, members, categories] = await Promise.all([
    monthNet(user.householdId, month),
    prisma.transaction.findMany({
      where: { householdId: user.householdId, occurredOn: { gte: month, lt: addMonths(month, 1) } },
      orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      include: { paidBy: { select: { name: true } }, category: { select: { id: true, name: true, parentId: true, parent: { select: { name: true } } } } },
    }),
    payers(user.householdId),
    listCategories(user.householdId),
  ]);
  const money = (cents: number) => formatCents(cents, user.household.currency);
  const sum = (kind: "INCOME" | "EXPENSE") => rows.reduce((s, t) => s + (t.kind === kind ? t.amount : 0), 0);

  // Filtres : sens, puis catégorie principale (une sous-catégorie compte pour sa catégorie parente).
  const kind = q.t === "INCOME" || q.t === "EXPENSE" ? q.t : undefined;
  const topOf = (t: (typeof rows)[number]) => (t.category ? (t.category.parentId ?? t.category.id) : "none");
  const topName = new Map(rows.map((t) => [topOf(t), t.category ? (t.category.parent?.name ?? t.category.name) : "Sans catégorie"]));
  const cat = q.c && topName.has(q.c) ? q.c : undefined;
  const shown = rows.filter((t) => (!kind || t.kind === kind) && (!cat || topOf(t) === cat));
  const filtered = !!(kind || cat);
  const entryDay = todayStr.startsWith(m) ? todayStr : `${m}-01`;

  return (
    <>
      <PageHeader
        eyebrow="Foyra / Opérations"
        title="Opérations"
        subtitle={`Dépenses et revenus enregistrés en ${monthLabel(month)}.`}
        actions={
          <>
            <MonthNav path="/operations" month={month} />
            <Link href="/operations/new" className="button"><Icon name="plus" className="size-4" />Ajouter</Link>
          </>
        }
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <Stat label="Revenus" value={money(sum("INCOME"))} tone="pos" />
        <Stat label="Dépenses" value={money(sum("EXPENSE"))} tone="neg" />
        <Stat label="Net du mois" value={money(net)} tone={net < 0 ? "neg" : undefined} note="Revenus − dépenses" />
      </div>

      <Fold title="Saisie rapide" className="mb-4">
        <EntryForm members={members} categories={categories} v={{ occurredOn: entryDay, paidById: user.id }} />
      </Fold>

      <Card variant="table">
        <SectionHeader
          className="flex-wrap"
          title="Liste des opérations"
          subtitle={filtered ? `${shown.length} sur ${rows.length} opération${rows.length > 1 ? "s" : ""}` : `${rows.length} opération${rows.length > 1 ? "s" : ""}`}
          action={
            rows.length > 0 && (
              <form method="get" className="filters" aria-label="Filtrer les opérations">
                <input type="hidden" name="m" value={m} />
                <label className="sr-only" htmlFor="f-t">Type</label>
                <select id="f-t" name="t" defaultValue={kind ?? ""}>
                  <option value="">Tous les types</option>
                  <option value="INCOME">Revenus</option>
                  <option value="EXPENSE">Dépenses</option>
                </select>
                <label className="sr-only" htmlFor="f-c">Catégorie</label>
                <select id="f-c" name="c" defaultValue={cat ?? ""}>
                  <option value="">Toutes catégories</option>
                  {[...topName].sort((a, b) => a[1].localeCompare(b[1], "fr")).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
                <button type="submit" className="secondary">Filtrer</button>
                {filtered && <Link href={`/operations?m=${m}`} className="tap-link text-label font-bold">Effacer</Link>}
              </form>
            )
          }
        />
        {shown.length === 0 ? (
          <EmptyState
            title={filtered ? "Aucune opération pour ces filtres" : "Aucune opération ce mois-ci"}
            action={filtered ? <Link href={`/operations?m=${m}`}>Effacer les filtres</Link> : <Link href="/operations/new">Ajouter une opération</Link>}
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Opération</th>
                  <th className="hidden md:table-cell">Date</th>
                  <th className="hidden lg:table-cell">Payé par</th>
                  <th className="hidden sm:table-cell">Partage</th>
                  <th className="num">Montant</th>
                  <th className="hidden sm:table-cell"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((t) => {
                  const income = t.kind === "INCOME";
                  const type = income ? "Revenu" : "Dépense";
                  const catName = t.category && `${t.category.parent ? `${t.category.parent.name} › ` : ""}${t.category.name}`;
                  const title = t.note || catName || type;
                  return (
                    <tr key={t.id}>
                      <td className="w-full max-w-0">
                        <div className="flex items-center gap-3">
                          <span className={`row-icon ${income ? "" : "expense"}`} title={type}><Icon name={income ? "arrowIn" : "arrowOut"} className="size-4" /></span>
                          <span className="min-w-0">
                            <Link href={`/operations/${t.id}`} className="block truncate text-heading no-underline hover:underline">{title}</Link>
                            <small className="block truncate text-label font-medium text-faint">
                              <span className="md:hidden">{dayLabel(t.occurredOn)} · </span>
                              {t.note ? (catName ?? "Sans catégorie") : type}
                              <span className="lg:hidden"> · {t.paidBy.name}</span>
                            </small>
                          </span>
                        </div>
                      </td>
                      <td className="hidden whitespace-nowrap text-muted md:table-cell">{dayLabel(t.occurredOn)}</td>
                      <td className="hidden lg:table-cell">{t.paidBy.name}</td>
                      <td className="hidden sm:table-cell"><Badge dot tone={t.shared ? "success" : "muted"}>{t.shared ? "Commune" : "Perso"}</Badge></td>
                      <td className={`num font-bold ${income ? "text-pos" : "text-neg"}`}>{income ? "+" : "−"}{money(t.amount)}</td>
                      <td className="hidden w-px sm:table-cell">
                        <Link href={`/operations/${t.id}`} className="icon-link" aria-label={`Modifier : ${title}`}><Icon name="chevron" className="size-4" /></Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
