import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { configuredProviders, DEFAULT_CLAUDE_MODEL, PROVIDER_LABELS } from "@/lib/llm";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { updateHouseholdAction, updateLlmAction, updateProfileAction } from "@/app/actions";
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
  const h = user.household;
  const providers = configuredProviders(h);

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

        {admin && (
          <Card>
            <CardHeader>
              <CardTitle>Rapport LLM</CardTitle>
              <CardDescription>Un fournisseur n’est proposé que si ses champs sont renseignés. Les clés ne sont jamais réaffichées : laisser vide pour les garder.</CardDescription>
            </CardHeader>
            <ActionForm action={updateLlmAction}>
              <Field name="llmProvider" label="Fournisseur du rapport">
                <select name="llmProvider" defaultValue={h.llmProvider ?? ""}>
                  <option value="">Automatique (premier configuré)</option>
                  {(["CLAUDE", "LOCAL"] as const).map((p) => <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>)}
                </select>
              </Field>
              <Field name="claudeApiKey" label="Claude : clé API Anthropic">
                <input name="claudeApiKey" type="password" autoComplete="off" placeholder={h.claudeApiKey ? "•••••• (enregistrée)" : "sk-ant-…"} />
              </Field>
              {h.claudeApiKey && <label className="check"><input type="checkbox" name="clear_claudeApiKey" />Effacer la clé Claude</label>}
              <Field name="claudeModel" label="Claude : modèle">
                <input name="claudeModel" maxLength={100} defaultValue={h.claudeModel ?? ""} placeholder={DEFAULT_CLAUDE_MODEL} />
              </Field>
              <Field name="localLlmUrl" label="Modèle local : URL compatible OpenAI (sans /v1)">
                <input name="localLlmUrl" type="url" maxLength={500} defaultValue={h.localLlmUrl ?? ""} placeholder="http://localhost:11434" />
              </Field>
              <Field name="localLlmModel" label="Modèle local : nom du modèle">
                <input name="localLlmModel" maxLength={100} defaultValue={h.localLlmModel ?? ""} />
              </Field>
              <Field name="localLlmApiKey" label="Modèle local : clé API (facultative)">
                <input name="localLlmApiKey" type="password" autoComplete="off" placeholder={h.localLlmApiKey ? "•••••• (enregistrée)" : ""} />
              </Field>
              {h.localLlmApiKey && <label className="check"><input type="checkbox" name="clear_localLlmApiKey" />Effacer la clé du modèle local</label>}
              <p className="m-0 text-sm text-muted">
                {providers.length ? `Configuré : ${providers.map((p) => PROVIDER_LABELS[p]).join(", ")}.` : "Aucun fournisseur configuré."}{" "}
                En mode Claude, montants, libellés, catégories et prénoms des membres sont envoyés à Anthropic. En mode local, rien ne sort du serveur.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="submit">Enregistrer</button>
                <button type="submit" name="intent" value="test" className="secondary">Tester la connexion</button>
              </div>
            </ActionForm>
          </Card>
        )}
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
