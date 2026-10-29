import Link from "next/link";
import type { Category, CategoryKind } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { listCategories } from "@/lib/categories";
import { formatCents } from "@/lib/money";
import { addDefaultCategoriesAction } from "../actions";
import { ActionForm } from "../form";
import { KIND_LABELS } from "./category-form";

export default async function CategoriesPage() {
  const user = await requireUser();
  const currency = user.household.currency;
  const categories = await listCategories(user.householdId);

  // Une sous-catégorie n'entre dans le budget que si elle et son parent sont activés.
  const row = (c: Category, label: string, parentEnabled = true) => (
    <li key={c.id}>
      <Link href={`/categories/${c.id}`}>
        <span>
          {label}
          {(!c.enabled || !parentEnabled) && <small className="muted">hors budget</small>}
        </span>
        <span className="amount">{c.forecastAmount != null ? formatCents(c.forecastAmount, currency) : <span className="muted">—</span>}</span>
      </Link>
    </li>
  );

  return (
    <>
      <h1>Catégories</h1>
      {categories.length === 0 && (
        <ActionForm action={addDefaultCategoriesAction}>
          <p className="muted">Aucune catégorie pour l’instant.</p>
          <button type="submit">Ajouter les catégories par défaut</button>
        </ActionForm>
      )}
      {(["EXPENSE", "INCOME"] as CategoryKind[]).map((kind) => (
        <section key={kind}>
          <div className="row">
            <h2>{KIND_LABELS[kind]}</h2>
            <Link href={`/categories/new?kind=${kind}`} className="button secondary">Ajouter</Link>
          </div>
          <ul className="list">
            {categories.filter((c) => c.kind === kind).flatMap((c) => [
              row(c, c.name),
              ...c.children.map((s) => row(s, `${c.name} › ${s.name}`, c.enabled)),
            ])}
          </ul>
        </section>
      ))}
    </>
  );
}
