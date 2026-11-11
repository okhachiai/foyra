import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { createMemberAction } from "@/app/actions";
import { ActionForm, Field } from "@/app/form";
import { SettingsNav } from "@/app/nav";
import { getI18n } from "@/lib/i18n-server";

export default async function MembersPage() {
  const admin = await requireAdmin();
  const { t } = await getI18n();
  const members = await prisma.user.findMany({ where: { householdId: admin.householdId }, orderBy: { createdAt: "asc" } });
  return (
    <>
      <PageHeader
        eyebrow={t("Settings")} title={t("Members")}
        subtitle={t("All members see and enter budgets and transactions; administrators manage members, the catalogue and AI.")}
      />
      <SettingsNav admin />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card variant="table">
          <SectionHeader title={t("Household members")} subtitle={t(members.length > 1 ? "{n} members" : "{n} member", { n: members.length })} />
          <ul className="list !px-0">
            {members.map((m) => (
              <li key={m.id}>
                <Link href={`/members/${m.id}`}>
                  <span className="flex min-w-0 items-center gap-3">
                    <span className={`avatar size-10 text-sm ${m.disabledAt ? "bg-raised text-muted" : "bg-accent-tint text-accent-ink"}`} aria-hidden>{m.name.trim().charAt(0).toUpperCase()}</span>
                    <span className="min-w-0">{m.name}{m.id === admin.id && <span className="font-medium text-muted"> ({t("you")})</span>}<small className="muted truncate">{m.email}</small></span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {m.disabledAt && <Badge tone="warning" dot>{t("Disabled")}</Badge>}
                    <Badge tone={m.role === "ADMIN" ? "success" : "muted"}>{t(m.role === "ADMIN" ? "Admin" : "Member")}</Badge>
                    <Icon name="chevron" className="size-4 text-faint" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <SectionHeader title={t("Add a member")} subtitle={t("The member changes their password from Settings › Security.")} />
          <ActionForm action={createMemberAction}>
            <Field name="name" label={t("First name")}><input name="name" required maxLength={100} /></Field>
            <Field name="email" label={t("Email")} hint={t("Sign-in identifier.")}><input name="email" type="email" required autoComplete="off" /></Field>
            <Field name="password" label={t("Temporary password")} hint={t("8 characters minimum, to pass on to the member.")}><input name="password" type="password" required minLength={8} autoComplete="new-password" /></Field>
            <Field name="role" label={t("Role")}>
              <select name="role" defaultValue="MEMBER">
                <option value="MEMBER">{t("Member")}</option>
                <option value="ADMIN">{t("Admin")}</option>
              </select>
            </Field>
            <div className="form-actions"><button type="submit">{t("Create the member")}</button></div>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
