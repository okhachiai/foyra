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

export default async function MemberPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const member = await prisma.user.findFirst({ where: { id: (await params).id, householdId: admin.householdId } });
  if (!member) notFound();
  const self = member.id === admin.id;
  const disabled = member.disabledAt !== null;

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/members" className="text-[inherit] no-underline hover:underline">Paramètres / Membres</Link>}
        title={member.name}
        subtitle={<>{member.email} {disabled && <Badge tone="warning" dot>Désactivé</Badge>}</>}
        actions={<Link href="/members" className="button ghost"><Icon name="chevronLeft" className="size-4" />Membres</Link>}
      />

      <div className="grid max-w-3xl gap-4">
        <Card>
          <SectionHeader title="Rôle" subtitle="Les administrateurs gèrent membres, catalogue de catégories et IA." />
          <ActionForm action={setRoleAction}>
            <input type="hidden" name="id" value={member.id} />
            <Field name="role" label="Rôle">
              <select name="role" defaultValue={member.role}>
                <option value="MEMBER">Membre</option>
                <option value="ADMIN">Admin</option>
              </select>
            </Field>
            <div className="form-actions"><button type="submit">Changer le rôle</button></div>
          </ActionForm>
        </Card>

        {!self && (
          <Card className={disabled ? undefined : "danger-card"}>
            <SectionHeader
              title={disabled ? "Réactiver l’accès" : "Désactiver l’accès"}
              subtitle={disabled
                ? "Le membre retrouve la connexion avec son mot de passe."
                : "Le membre est déconnecté et ne peut plus se connecter ; ses opérations sont conservées."}
            />
            <ActionForm
              action={setDisabledAction}
              confirm={disabled ? `Réactiver l’accès de ${member.name} ?` : `Désactiver ${member.name} ? Sa session sera fermée immédiatement.`}
            >
              <input type="hidden" name="id" value={member.id} />
              <input type="hidden" name="disabled" value={disabled ? "0" : "1"} />
              <div className="form-actions">
                <button type="submit" className={disabled ? "secondary" : "danger"}>{disabled ? "Réactiver" : "Désactiver"}</button>
              </div>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
