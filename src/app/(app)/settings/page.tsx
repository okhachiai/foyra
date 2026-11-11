import { requireUser } from "@/lib/auth";
import { Card, SectionHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { updateHouseholdAction, updateProfileAction } from "@/app/actions";
import { ActionForm, Field } from "@/app/form";
import { SettingsNav } from "@/app/nav";
import { LanguageSwitch } from "@/components/ui/language-switch";
import { getI18n } from "@/lib/i18n-server";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string }> }) {
  const user = await requireUser();
  const { t } = await getI18n();
  const admin = user.role === "ADMIN";
  const ok = (await searchParams).ok;

  return (
    <>
      <PageHeader eyebrow={t("Settings")} title={t("General")} subtitle={t("Your profile, language, the household and how monthly budgets are created.")} />
      <SettingsNav admin={admin} />
      {ok && <p role="status" className="alert success mb-4"><Icon name="shield" className="mt-0.5 size-4 shrink-0" />{t("Changes saved.")}</p>}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card>
          <SectionHeader title={t("Profile")} subtitle={`${user.email} · ${t(admin ? "Administrator" : "Member")}`} />
          <ActionForm action={updateProfileAction}>
            <Field name="name" label={t("Display name")} hint={t("Visible to household members (paid by, split).")}>
              <input name="name" required maxLength={100} autoComplete="name" defaultValue={user.name} />
            </Field>
            <div className="form-actions"><button type="submit">{t("Save")}</button></div>
          </ActionForm>
        </Card>

        <Card>
          <SectionHeader title={t("Language")} subtitle={t("Interface language on this browser. English by default.")} />
          <LanguageSwitch />
        </Card>

        <Card>
          <SectionHeader title={t("Household and monthly budget")} subtitle={admin ? undefined : t("Read only: reserved for administrators.")} />
          <ActionForm action={updateHouseholdAction}>
            <fieldset disabled={!admin} className="contents">
              <Field name="householdName" label={t("Household name")}>
                <input name="householdName" required maxLength={100} defaultValue={user.household.name} />
              </Field>
              <Field name="currency" label={t("Currency")} hint={t("Set for the whole household.")}>
                <input name="currency" value={t("Euro (EUR)")} readOnly aria-readonly />
              </Field>
              <Field name="budgetSource" label={t("Creating a new monthly budget")} hint={t("Without a previous budget, the category templates are used. Budgets already created never change.")}>
                <select name="budgetSource" defaultValue={user.household.budgetSource}>
                  <option value="PREVIOUS">{t("Carry over the previous budget’s recurring lines")}</option>
                  <option value="TEMPLATES">{t("Start from the category templates")}</option>
                </select>
              </Field>
              {admin && <div className="form-actions"><button type="submit">{t("Save")}</button></div>}
            </fieldset>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
