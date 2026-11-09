import { requireAdmin } from "@/lib/auth";
import { configuredProviders, DEFAULT_CLAUDE_MODEL, PROVIDER_LABELS } from "@/lib/llm";
import { Badge } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { updateLlmAction } from "@/app/actions";
import { ActionForm, Field } from "@/app/form";
import { SettingsNav } from "@/app/nav";

/** Fournisseur du rapport IA (Claude ou modèle local) ; administrateurs uniquement. */
export default async function AiSettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string }> }) {
  const admin = await requireAdmin();
  const ok = (await searchParams).ok;
  const h = admin.household;
  const providers = configuredProviders(h);

  return (
    <>
      <PageHeader eyebrow="Paramètres" title="IA" subtitle="Fournisseur utilisé pour les rapports et la répartition du budget." />
      <SettingsNav admin />
      {ok && <p role="status" className="alert success mb-4"><Icon name="shield" className="mt-0.5 size-4 shrink-0" />Réglages IA enregistrés.</p>}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <SectionHeader
            title="Fournisseur du rapport"
            subtitle="Un fournisseur n’est proposé que si ses champs sont renseignés."
            action={providers.length
              ? <Badge tone="success" dot>{providers.map((p) => PROVIDER_LABELS[p]).join(", ")}</Badge>
              : <Badge tone="muted" dot>Non configuré</Badge>}
          />
          <ActionForm action={updateLlmAction}>
            <Field name="llmProvider" label="Fournisseur préféré">
              <select name="llmProvider" defaultValue={h.llmProvider ?? ""}>
                <option value="">Automatique (premier configuré)</option>
                {(["CLAUDE", "LOCAL"] as const).map((p) => <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>)}
              </select>
            </Field>

            <h3 className="m-0 mt-2 text-label font-bold uppercase tracking-wider text-faint">Claude</h3>
            <Field name="claudeApiKey" label="Clé API Anthropic" hint="Jamais réaffichée : laisser vide pour garder la clé enregistrée.">
              <input name="claudeApiKey" type="password" autoComplete="off" placeholder={h.claudeApiKey ? "•••••• (enregistrée)" : "sk-ant-…"} />
            </Field>
            {h.claudeApiKey && <label className="check"><input type="checkbox" name="clear_claudeApiKey" />Effacer la clé Claude</label>}
            <Field name="claudeModel" label="Modèle" hint={`Vide : ${DEFAULT_CLAUDE_MODEL}.`}>
              <input name="claudeModel" maxLength={100} defaultValue={h.claudeModel ?? ""} placeholder={DEFAULT_CLAUDE_MODEL} />
            </Field>

            <h3 className="m-0 mt-2 text-label font-bold uppercase tracking-wider text-faint">Modèle local</h3>
            <Field name="localLlmUrl" label="URL compatible OpenAI" hint="Sans /v1, ex. http://localhost:11434">
              <input name="localLlmUrl" type="url" maxLength={500} defaultValue={h.localLlmUrl ?? ""} placeholder="http://localhost:11434" />
            </Field>
            <Field name="localLlmModel" label="Nom du modèle">
              <input name="localLlmModel" maxLength={100} defaultValue={h.localLlmModel ?? ""} />
            </Field>
            <Field name="localLlmApiKey" label="Clé API (facultative)" hint="Jamais réaffichée : laisser vide pour la garder.">
              <input name="localLlmApiKey" type="password" autoComplete="off" placeholder={h.localLlmApiKey ? "•••••• (enregistrée)" : ""} />
            </Field>
            {h.localLlmApiKey && <label className="check"><input type="checkbox" name="clear_localLlmApiKey" />Effacer la clé du modèle local</label>}

            <div className="form-actions">
              <button type="submit">Enregistrer</button>
              <button type="submit" name="intent" value="test" className="secondary">Tester la connexion</button>
            </div>
          </ActionForm>
        </Card>

        <Card>
          <SectionHeader title="Données envoyées" />
          <dl className="facts-list">
            <div><dt>Claude</dt><dd className="whitespace-normal font-semibold">Montants, libellés, catégories, prénoms → Anthropic</dd></div>
            <div><dt>Modèle local</dt><dd className="whitespace-normal font-semibold">Rien ne sort du serveur</dd></div>
          </dl>
          <p className="m-0 text-label text-muted">Le test utilise les valeurs du formulaire sans les enregistrer.</p>
        </Card>
      </div>
    </>
  );
}
