import { redirect } from "next/navigation";
import { householdExists } from "@/lib/auth";
import { setupAction } from "../actions";
import { ActionForm, Field } from "../form";

export default async function SetupPage() {
  if (await householdExists()) redirect("/login");
  return (
    <main className="narrow">
      <h1>Bienvenue sur Foyra</h1>
      <p className="muted">Créez votre foyer et le compte administrateur. Aucune donnée n’est créée automatiquement.</p>
      <ActionForm action={setupAction}>
        {process.env.SETUP_TOKEN && (
          <Field name="setupToken" label="Jeton d’installation (variable SETUP_TOKEN du serveur)">
            <input name="setupToken" type="password" required autoComplete="off" />
          </Field>
        )}
        <Field name="householdName" label="Nom du foyer"><input name="householdName" required maxLength={100} /></Field>
        <Field name="name" label="Votre prénom"><input name="name" required maxLength={100} autoComplete="given-name" /></Field>
        <Field name="email" label="Email"><input name="email" type="email" required autoComplete="email" /></Field>
        <Field name="password" label="Mot de passe (8 caractères min.)"><input name="password" type="password" required minLength={8} autoComplete="new-password" /></Field>
        <button type="submit">Créer le foyer</button>
      </ActionForm>
    </main>
  );
}
