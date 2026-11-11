import { requireUser } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { changePasswordAction } from "@/app/actions";
import { ActionForm, Field } from "@/app/form";
import { SettingsNav } from "@/app/nav";
import { getI18n } from "@/lib/i18n-server";

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ ok?: string }> }) {
  const user = await requireUser();
  const { t } = await getI18n();
  const admin = user.role === "ADMIN";
  const ok = (await searchParams).ok === "1";
  return (
    <>
      <PageHeader eyebrow={t("Settings")} title={t("Security")} subtitle={t("Your account and your password.")} />
      <SettingsNav admin={admin} />
      {ok && <p role="status" className="alert success mb-4"><Icon name="shield" className="mt-0.5 size-4 shrink-0" />{t("Password changed. Your other sessions have been closed.")}</p>}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card>
          <SectionHeader title={t("Account")} />
          <div className="flex items-center gap-3">
            <span className="avatar size-12 shrink-0 bg-accent-tint text-lg text-accent-ink" aria-hidden>{user.name.trim().charAt(0).toUpperCase()}</span>
            <div className="min-w-0">
              <p className="m-0 truncate font-bold text-heading">{user.name}</p>
              <p className="m-0 truncate text-label text-muted">{user.email}</p>
            </div>
          </div>
          <div><Badge tone={admin ? "success" : "muted"}>{t(admin ? "Administrator" : "Member")}</Badge></div>
        </Card>

        <Card>
          <SectionHeader title={t("Change the password")} subtitle={t("Other open sessions will be closed.")} />
          <ActionForm action={changePasswordAction}>
            <input type="text" name="username" autoComplete="username" value={user.email} readOnly hidden />
            <Field name="current" label={t("Current password")}><input name="current" type="password" required autoComplete="current-password" /></Field>
            <Field name="password" label={t("New password")} hint={t("8 characters minimum.")}><input name="password" type="password" required minLength={8} autoComplete="new-password" /></Field>
            <Field name="confirm" label={t("Confirmation")}><input name="confirm" type="password" required minLength={8} autoComplete="new-password" /></Field>
            <div className="form-actions"><button type="submit">{t("Change the password")}</button></div>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
