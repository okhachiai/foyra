import { requireAdmin } from "@/lib/auth";
import { configuredProviders, DEFAULT_CLAUDE_MODEL, PROVIDER_LABELS, secretStorageReady } from "@/lib/llm";
import { Badge } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { updateLlmAction } from "@/app/actions";
import { ActionForm, Field } from "@/app/form";
import { SettingsNav } from "@/app/nav";
import { LOCALES, LOCALE_NAMES } from "@/lib/i18n";
import { prisma } from "@/lib/db";
import { getI18n } from "@/lib/i18n-server";

/** AI report provider (Claude or a local model); administrators only. */
export default async function AiSettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string }> }) {
  const admin = await requireAdmin();
  const { t } = await getI18n();
  const ok = (await searchParams).ok;
  const h = admin.household;
  const providers = configuredProviders(h);
  const lastAuto = await prisma.report.findFirst({ where: { householdId: h.id, trigger: "AUTO" }, orderBy: { createdAt: "desc" } });

  return (
    <>
      <PageHeader eyebrow={t("Settings")} title={t("AI")} subtitle={t("Provider used for reports and budget allocation.")} />
      <SettingsNav admin />
      {ok && <p role="status" className="alert success mb-4"><Icon name="shield" className="mt-0.5 size-4 shrink-0" />{t("AI settings saved.")}</p>}

      {!secretStorageReady() && <p role="alert" className="alert danger mb-4">{t("API key storage is disabled until the operator configures LLM_KEY_SECRET.")}</p>}
      {!process.env.CRON_TOKEN && <p role="status" className="alert mb-4">{t("AI generation is unavailable until the operator configures the report worker.")}</p>}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <SectionHeader
            title={t("Report provider")}
            subtitle={t("Settings entered do not guarantee that the model is ready. Test structured responses before saving.")}
            action={providers.length
              ? <Badge tone="muted" dot>{providers.map((p) => t(PROVIDER_LABELS[p])).join(", ")}</Badge>
              : <Badge tone="muted" dot>{t("Not configured")}</Badge>}
          />
          <ActionForm action={updateLlmAction}>
            <Field name="llmProvider" label={t("Preferred provider")}>
              <select name="llmProvider" defaultValue={h.llmProvider ?? ""}>
                <option value="">{t("Automatic (first configured)")}</option>
                {(["CLAUDE", "LOCAL"] as const).map((p) => <option key={p} value={p}>{t(PROVIDER_LABELS[p])}</option>)}
              </select>
            </Field>

            <h3 className="m-0 mt-2 text-label font-bold uppercase tracking-wider text-faint">Claude</h3>
            <Field name="claudeApiKey" label={t("Anthropic API key")} hint={t("Never shown again: leave empty to keep the saved key.")}>
              <input name="claudeApiKey" type="password" autoComplete="off" placeholder={h.claudeApiKey ? `•••••• (${t("saved")})` : "sk-ant-…"} />
            </Field>
            {h.claudeApiKey && <label className="check"><input type="checkbox" name="clear_claudeApiKey" />{t("Erase the Claude key")}</label>}
            <Field name="claudeModel" label={t("Model")} hint={t("Empty: {model}.", { model: DEFAULT_CLAUDE_MODEL })}>
              <input name="claudeModel" maxLength={100} defaultValue={h.claudeModel ?? ""} placeholder={DEFAULT_CLAUDE_MODEL} />
            </Field>

            <h3 className="m-0 mt-2 text-label font-bold uppercase tracking-wider text-faint">{t("Local model")}</h3>
            <Field name="localLlmUrl" label={t("OpenAI-compatible URL")} hint={t("Without /v1, e.g. http://localhost:11434")}>
              <input name="localLlmUrl" type="url" maxLength={500} defaultValue={h.localLlmUrl ?? ""} placeholder="http://localhost:11434" />
            </Field>
            <Field name="localLlmModel" label={t("Model name")}>
              <input name="localLlmModel" maxLength={100} defaultValue={h.localLlmModel ?? ""} />
            </Field>
            <Field name="localLlmApiKey" label={t("API key (optional)")} hint={t("Never shown again: leave empty to keep it.")}>
              <input name="localLlmApiKey" type="password" autoComplete="off" placeholder={h.localLlmApiKey ? `•••••• (${t("saved")})` : ""} />
            </Field>
            {h.localLlmApiKey && <label className="check"><input type="checkbox" name="clear_localLlmApiKey" />{t("Erase the local model key")}</label>}

            <Field name="aiLocale" label={t("Automatic report language")}>
              <select name="aiLocale" defaultValue={h.aiLocale}>{LOCALES.map((l) => <option key={l} value={l}>{LOCALE_NAMES[l]}</option>)}</select>
            </Field>
            <label className="check"><input type="checkbox" name="aiMinimizeData" defaultChecked={h.aiMinimizeData} />{t("Exclude transaction notes and member names from AI requests")}</label>
            <label className="check"><input type="checkbox" name="aiAutomatic" defaultChecked={h.aiAutomatic} />{t("Enable automatic reports (may use paid API credits)")}</label>
            <p className="text-label text-muted">{t("Automatic reports run at the operator's scheduled time. The household is limited to twenty reports per twenty-four hours.")}</p>
            {lastAuto && <p className="text-label text-muted">{t("Last automatic report")}: {new Intl.DateTimeFormat(h.aiLocale, { dateStyle: "short", timeStyle: "short", timeZone: h.timezone }).format(lastAuto.createdAt)} · {t(lastAuto.status)}</p>}
            <div className="form-actions">
              <button type="submit">{t("Save")}</button>
              <button type="submit" name="intent" value="test" className="secondary">{t("Test the connection")}</button>
            </div>
          </ActionForm>
        </Card>

        <Card>
          <SectionHeader title={t("Data sent")} />
          <dl className="facts-list">
            <div><dt>Claude</dt><dd className="whitespace-normal font-semibold">{t("Budget amounts and labels are sent to Anthropic. Notes and names are excluded when data minimisation is enabled.")}</dd></div>
            <div><dt>{t("Local model")}</dt><dd className="whitespace-normal font-semibold">{t("Data is sent to the configured server. Its location and any cloud forwarding depend on your provider.")}</dd></div>
          </dl>
          {h.localLlmUrl && <p className="text-label text-muted">{t("Destination")}: {new URL(h.localLlmUrl).origin}</p>}
          <p className="m-0 text-label text-muted">{t("The test uses the form values without saving them.")}</p>
        </Card>
      </div>
    </>
  );
}
