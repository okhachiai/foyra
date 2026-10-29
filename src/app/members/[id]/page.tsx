import Link from "next/link";
import { notFound } from "next/navigation";
import { getAccess } from "@/lib/access";
import { requireAdmin } from "@/lib/auth";
import { NotFoundError } from "@/lib/ledger";
import { saveAccessAction } from "../../actions";
import { ActionForm, Field } from "../../form";
import { KIND_LABELS } from "../../accounts/kinds";

export default async function MemberAccessPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const { member, accounts } = await getAccess(admin.householdId, (await params).id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });

  return (
    <>
      <p><Link href="/members">← Membres</Link></p>
      <h1>Accès de {member.name}</h1>
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
  );
}
