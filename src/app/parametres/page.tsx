import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { updateHouseholdAction, updateProfileAction } from "../actions";
import { ActionForm, Field } from "../form";
import { SettingsNav } from "../nav";

const SECTIONS = [
  ["/accounts", "Comptes", "Création, modification, archivage et partage des comptes."],
  ["/categories", "Catégories", "Catalogue des revenus et dépenses, modèles de budget."],
  ["/charges", "Récurrences", "Échéances mensuelles indicatives : aucun paiement automatique."],
  ["/members", "Membres et permissions", "Membres du foyer et rôles (administrateurs)."],
] as const;

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string }> }) {
  const user = await requireUser();
  const admin = user.role === "ADMIN";
  const ok = (await searchParams).ok;

  return (
    <>
      <h1>Paramètres</h1>
      <SettingsNav admin={admin} />
      {ok && <p role="status" className="text-pos">Modifications enregistrées.</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Préférences</CardTitle>
          </CardHeader>
          <ActionForm action={updateProfileAction}>
            <Field name="name" label="Nom affiché">
              <input name="name" required maxLength={100} autoComplete="name" defaultValue={user.name} />
            </Field>
            <p className="m-0 text-sm text-muted">{user.email} · {admin ? "Administrateur" : "Membre"}</p>
            <button type="submit">Enregistrer</button>
          </ActionForm>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Foyer et budget mensuel</CardTitle>
            {!admin && <CardDescription>Réservé aux administrateurs.</CardDescription>}
          </CardHeader>
          <ActionForm action={updateHouseholdAction}>
            <fieldset disabled={!admin} className="contents">
              <Field name="householdName" label="Nom du foyer">
                <input name="householdName" required maxLength={100} defaultValue={user.household.name} />
              </Field>
              <Field name="currency" label="Devise">
                <input name="currency" value="Euro (EUR)" readOnly aria-readonly />
              </Field>
              <Field name="budgetSource" label="Création d’un nouveau budget mensuel">
                <select name="budgetSource" defaultValue={user.household.budgetSource}>
                  <option value="PREVIOUS">Reprendre les lignes récurrentes du budget précédent</option>
                  <option value="TEMPLATES">Partir des modèles de catégories</option>
                </select>
              </Field>
              <p className="m-0 text-sm text-muted">
                Sans budget précédent, les modèles de catégories sont utilisés. Les budgets déjà créés ne changent jamais.
              </p>
              {admin && <button type="submit">Enregistrer</button>}
            </fieldset>
          </ActionForm>
        </Card>
      </div>

      <h2>Sections</h2>
      <ul className="list">
        {SECTIONS.filter(([href]) => admin || href !== "/members").map(([href, title, text]) => (
          <li key={href}>
            <Link href={href}>
              <span>{title}<small className="muted">{text}</small></span>
              <span aria-hidden className="muted">→</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
