import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { setDisabledAction, setRoleAction } from "@/app/actions";
import { ActionForm, Field } from "@/app/form";
import { getI18n } from "@/lib/i18n-server";

export default async function MemberPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const { t } = await getI18n();
  const member = await prisma.user.findFirst({ where: { id: (await params).id, householdId: admin.householdId } });
  if (!member) notFound();
  const self = member.id === admin.id;
  const disabled = member.disabledAt !== null;

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/members" className="text-[inherit] no-underline hover:underline">{t("Settings")} / {t("Members")}</Link>}
        title={member.name}
        subtitle={<>{member.email} {disabled && <Badge tone="warning" dot>{t("Disabled")}</Badge>}</>}
        actions={<Link href="/members" className="button ghost"><Icon name="chevronLeft" className="size-4" />{t("Members")}</Link>}
      />

      <div className="grid max-w-3xl gap-4">
        <Card>
          <SectionHeader title={t("Role")} subtitle={t("Administrators manage members, the category catalogue and AI.")} />
          <ActionForm action={setRoleAction}>
            <input type="hidden" name="id" value={member.id} />
            <Field name="role" label={t("Role")}>
              <select name="role" defaultValue={member.role}>
                <option value="MEMBER">{t("Member")}</option>
                <option value="ADMIN">{t("Admin")}</option>
              </select>
            </Field>
            <div className="form-actions"><button type="submit">{t("Change the role")}</button></div>
          </ActionForm>
        </Card>

        {!self && (
          <Card className={disabled ? undefined : "danger-card"}>
            <SectionHeader
              title={t(disabled ? "Restore access" : "Disable access")}
              subtitle={t(disabled
                ? "The member can sign in again with their password."
                : "The member is signed out and can no longer sign in; their transactions are kept.")}
            />
            <ActionForm
              action={setDisabledAction}
              confirm={t(disabled ? "Restore access for {name}?" : "Disable {name}? Their session will be closed immediately.", { name: member.name })}
            >
              <input type="hidden" name="id" value={member.id} />
              <input type="hidden" name="disabled" value={disabled ? "0" : "1"} />
              <div className="form-actions">
                <button type="submit" className={disabled ? "secondary" : "danger"}>{t(disabled ? "Reactivate" : "Disable")}</button>
              </div>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
