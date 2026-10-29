import Link from "next/link";
import { getScope, getSharing } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { saveSharingAction } from "../../../actions";
import { ActionForm, Field } from "../../../form";
import { loadAccount } from "../load";

export default async function SharingPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const scope = await getScope(user);
  const account = await loadAccount(scope, (await params).id, "MANAGE");
  const { sharing, users } = await getSharing(scope, account.id);
  const others = users.filter((u) => u.id !== user.id);

  return (
    <>
      <p><Link href={`/accounts/${account.id}`}>← {account.name}</Link></p>
      <h1>Partage · {account.name}</h1>
      <p className="muted">
        Lecture : voir le compte et ses opérations. Écriture : saisir et modifier des opérations. Gestion : modifier, archiver et régler le partage.
        Vous restez gestionnaire de ce compte.
      </p>
      <ActionForm action={saveSharingAction}>
        <input type="hidden" name="id" value={account.id} />
        <Field name="sharing" label="Partager avec">
          <select name="sharing" defaultValue={sharing}>
            <option value="SELECTED">Membres sélectionnés ci-dessous</option>
            <option value="HOUSEHOLD">Tout le foyer (écriture au minimum pour chacun)</option>
          </select>
        </Field>
        {others.length === 0 && <p className="muted m-0">Aucun autre membre dans le foyer.</p>}
        {others.map((u) => (
          <Field key={u.id} name={`access:${u.id}`} label={`${u.name}${u.role === "ADMIN" ? " · admin" : ""}${u.disabledAt ? " · désactivé" : ""}`}>
            <select name={`access:${u.id}`} defaultValue={u.level ?? "NONE"}>
              <option value="NONE">Aucun accès explicite</option>
              <option value="READ">Lecture</option>
              <option value="WRITE">Écriture</option>
              <option value="MANAGE">Gestion</option>
            </select>
          </Field>
        ))}
        <button type="submit">Enregistrer le partage</button>
      </ActionForm>
    </>
  );
}
