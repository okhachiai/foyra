import Link from "next/link";
import { notFound } from "next/navigation";
import { getAccess } from "@/lib/access";
import { requireAdmin } from "@/lib/auth";
import { NotFoundError } from "@/lib/ledger";
import { saveAccessAction, setDisabledAction, setRoleAction } from "../../actions";
import { ActionForm, Field } from "../../form";
import { KIND_LABELS } from "../../accounts/kinds";

export default async function MemberPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const { member, accounts } = await getAccess(admin.householdId, (await params).id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
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

      {member.role === "MEMBER" && (
        <>
          <h2>Accès aux comptes</h2>
          <p className="muted">Sans accès, le compte, ses opérations, charges et crédits sont invisibles pour ce membre.</p>
          {accounts.length === 0 ? (
            <p className="muted">Aucun compte pour l’instant.</p>
          ) : (
            <ActionForm action={saveAccessAction}>
              <input type="hidden" name="id" value={member.id} />
              {accounts.map((a) => (
                <Field key={a.id} name={`access:${a.id}`} label={`${a.name} · ${KIND_LABELS[a.kind]}${a.archivedAt ? " · archivé" : ""}`}>
                  <select name={`access:${a.id}`} defaultValue={a.level ?? "NONE"}>
                    <option value="NONE">Aucun accès</option>
                    <option value="READ">Lecture</option>
                    <option value="WRITE">Écriture</option>
                  </select>
                </Field>
              ))}
              <button type="submit">Enregistrer</button>
            </ActionForm>
          )}
        </>
      )}
    </>
  );
}
