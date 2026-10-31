import { requireUser } from "@/lib/auth";
import { changePasswordAction } from "@/app/actions";
import { ActionForm, Field } from "@/app/form";
import { SettingsNav } from "@/app/nav";

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ ok?: string }> }) {
  const user = await requireUser();
  const ok = (await searchParams).ok === "1";
  return (
    <>
      <h1>Mon compte</h1>
      <SettingsNav admin={user.role === "ADMIN"} />
      <p>{user.name}<br /><span className="muted">{user.email} · {user.role === "ADMIN" ? "Admin" : "Membre"}</span></p>
      <h2>Changer le mot de passe</h2>
      {ok && <p role="status">Mot de passe modifié. Vos autres sessions ont été fermées.</p>}
      <ActionForm action={changePasswordAction}>
        <input type="text" name="username" autoComplete="username" value={user.email} readOnly hidden />
        <Field name="current" label="Mot de passe actuel"><input name="current" type="password" required autoComplete="current-password" /></Field>
        <Field name="password" label="Nouveau mot de passe (8 caractères min.)"><input name="password" type="password" required minLength={8} autoComplete="new-password" /></Field>
        <Field name="confirm" label="Confirmation"><input name="confirm" type="password" required minLength={8} autoComplete="new-password" /></Field>
        <button type="submit">Enregistrer</button>
      </ActionForm>
    </>
  );
}
