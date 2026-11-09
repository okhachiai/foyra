import { redirect } from "next/navigation";
import { householdExists, setupToken } from "@/lib/auth";
import { AuthShell } from "@/components/ui/auth-shell";
import { setupAction } from "../actions";
import { ActionForm, Field } from "../form";

export default async function SetupPage() {
  if (await householdExists()) redirect("/login");
  setupToken(); // tire et journalise le jeton dès l'affichage
  return (
    <AuthShell
      title="Bienvenue sur Foyra"
      subtitle="Créez votre foyer et le compte administrateur. Aucune donnée n’est créée automatiquement."
      foot="Vous pourrez ensuite ajouter les membres du foyer depuis Paramètres › Membres."
    >
      <ActionForm action={setupAction}>
        <Field
          name="setupToken" label="Jeton d’installation"
          hint={process.env.SETUP_TOKEN ? "Valeur de la variable SETUP_TOKEN du serveur." : "Affiché dans les journaux du serveur."}
        >
          <input name="setupToken" type="password" required autoComplete="off" />
        </Field>
        <Field name="householdName" label="Nom du foyer"><input name="householdName" required maxLength={100} /></Field>
        <Field name="name" label="Votre prénom"><input name="name" required maxLength={100} autoComplete="given-name" /></Field>
        <Field name="email" label="Email" hint="Votre identifiant de connexion."><input name="email" type="email" required autoComplete="email" /></Field>
        <Field name="password" label="Mot de passe" hint="8 caractères minimum."><input name="password" type="password" required minLength={8} autoComplete="new-password" /></Field>
        <button type="submit" className="mt-1 w-full">Créer le foyer</button>
      </ActionForm>
    </AuthShell>
  );
}
