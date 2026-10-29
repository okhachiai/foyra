import { redirect } from "next/navigation";
import { householdExists } from "@/lib/auth";
import { loginAction } from "../actions";
import { ActionForm, Field } from "../form";

export default async function LoginPage() {
  if (!(await householdExists())) redirect("/setup");
  return (
    <main className="narrow">
      <h1>Foyra</h1>
      <ActionForm action={loginAction}>
        <Field name="email" label="Email"><input name="email" type="email" required autoComplete="email" /></Field>
        <Field name="password" label="Mot de passe"><input name="password" type="password" required autoComplete="current-password" /></Field>
        <button type="submit">Se connecter</button>
      </ActionForm>
    </main>
  );
}
