import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { configuredProviders, PROVIDER_LABELS } from "@/lib/llm";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { updateHouseholdAction, updateProfileAction } from "@/app/actions";
import { ActionForm, Field } from "@/app/form";
import { SettingsNav } from "@/app/nav";

const SECTIONS = [
  ["/categories", "Catégories", "Catalogue des revenus et dépenses, modèles de budget."],
  ["/charges", "Récurrences", "Échéances mensuelles indicatives : aucun paiement automatique."],
  ["/members", "Membres et permissions", "Membres du foyer et rôles (administrateurs)."],
] as const;

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string }> }) {
  const user = await requireUser();
  const admin = user.role === "ADMIN";
  const ok = (await searchParams).ok;
  const providers = configuredProviders();
  const pref = user.household.llmProvider;

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
              {providers.length ? (
                <Field name="llmProvider" label="Fournisseur du rapport">
                  <select name="llmProvider" defaultValue={pref && providers.includes(pref) ? pref : ""}>
                    <option value="">Automatique (premier configuré)</option>
                    {providers.map((p) => <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>)}
                  </select>
                </Field>
              ) : (
                <p className="m-0 text-sm text-muted">Aucun fournisseur configuré (ANTHROPIC_API_KEY ou LOCAL_LLM_URL + LOCAL_LLM_MODEL).</p>
              )}
              <p className="m-0 text-sm text-muted">
                En mode Claude, montants, libellés, catégories et prénoms des membres sont envoyés à Anthropic. En mode local, rien ne sort du serveur.
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
