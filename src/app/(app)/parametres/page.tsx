import { requireUser } from "@/lib/auth";
import { Card, SectionHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { updateHouseholdAction, updateProfileAction } from "@/app/actions";
import { ActionForm, Field } from "@/app/form";
import { SettingsNav } from "@/app/nav";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string }> }) {
  const user = await requireUser();
  const admin = user.role === "ADMIN";
  const ok = (await searchParams).ok;

  return (
    <>
      <PageHeader eyebrow="Paramètres" title="Général" subtitle="Votre profil, le foyer et la création des budgets mensuels." />
      <SettingsNav admin={admin} />
      {ok && <p role="status" className="alert success mb-4"><Icon name="shield" className="mt-0.5 size-4 shrink-0" />Modifications enregistrées.</p>}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card>
          <SectionHeader title="Profil" subtitle={`${user.email} · ${admin ? "Administrateur" : "Membre"}`} />
          <ActionForm action={updateProfileAction}>
            <Field name="name" label="Nom affiché" hint="Visible par les membres du foyer (payé par, répartition).">
              <input name="name" required maxLength={100} autoComplete="name" defaultValue={user.name} />
            </Field>
            <div className="form-actions"><button type="submit">Enregistrer</button></div>
          </ActionForm>
        </Card>

        <Card>
          <SectionHeader title="Foyer et budget mensuel" subtitle={admin ? undefined : "Lecture seule : réservé aux administrateurs."} />
          <ActionForm action={updateHouseholdAction}>
            <fieldset disabled={!admin} className="contents">
              <Field name="householdName" label="Nom du foyer">
                <input name="householdName" required maxLength={100} defaultValue={user.household.name} />
              </Field>
              <Field name="currency" label="Devise" hint="Fixée pour tout le foyer.">
                <input name="currency" value="Euro (EUR)" readOnly aria-readonly />
              </Field>
              <Field name="budgetSource" label="Création d’un nouveau budget mensuel" hint="Sans budget précédent, les modèles de catégories sont utilisés. Les budgets déjà créés ne changent jamais.">
                <select name="budgetSource" defaultValue={user.household.budgetSource}>
                  <option value="PREVIOUS">Reprendre les lignes récurrentes du budget précédent</option>
                  <option value="TEMPLATES">Partir des modèles de catégories</option>
                </select>
              </Field>
              {admin && <div className="form-actions"><button type="submit">Enregistrer</button></div>}
            </fieldset>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
