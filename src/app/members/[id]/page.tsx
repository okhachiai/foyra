import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { setDisabledAction, setRoleAction } from "../../actions";
import { ActionForm, Field } from "../../form";

export default async function MemberPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const member = await prisma.user.findFirst({ where: { id: (await params).id, householdId: admin.householdId } });
  if (!member) notFound();
  const self = member.id === admin.id;

  return (
    <>
      <p><Link href="/members">← Membres</Link></p>
      <h1>{member.name}</h1>
      <p className="muted">{member.email}{member.disabledAt ? " · désactivé" : ""}</p>

      <h2>Rôle</h2>
      <ActionForm action={setRoleAction}>
        <input type="hidden" name="id" value={member.id} />
        <Field name="role" label="Rôle">
          <select name="role" defaultValue={member.role}>
            <option value="MEMBER">Membre</option>
            <option value="ADMIN">Admin</option>
          </select>
        </Field>
        <button type="submit">Changer le rôle</button>
      </ActionForm>

      {!self && (
        <>
          <h2>{member.disabledAt ? "Réactiver" : "Désactiver"}</h2>
          <p className="muted">
            {member.disabledAt
              ? "Le compte retrouve la connexion avec son mot de passe et ses accès."
              : "Le compte est déconnecté et ne peut plus se connecter ; ses accès aux comptes sont conservés."}
          </p>
          <ActionForm
            action={setDisabledAction}
            confirm={member.disabledAt ? `Réactiver ${member.name} ?` : `Désactiver ${member.name} ? Sa session sera fermée.`}
          >
            <input type="hidden" name="id" value={member.id} />
            <input type="hidden" name="disabled" value={member.disabledAt ? "0" : "1"} />
            <button type="submit">{member.disabledAt ? "Réactiver" : "Désactiver"}</button>
          </ActionForm>
        </>
      )}

      <h2>Accès aux comptes</h2>
      <p className="muted">
        Les accès (lecture, écriture, gestion) se règlent depuis la page de chaque compte, par ses gestionnaires.
        Un administrateur a accès à tous les comptes du foyer.
      </p>
    </>
  );
}
