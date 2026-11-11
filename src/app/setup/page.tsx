import { redirect } from "next/navigation";
import { householdExists, setupToken } from "@/lib/auth";
import { AuthShell } from "@/components/ui/auth-shell";
import { setupAction } from "../actions";
import { ActionForm, Field } from "../form";
import { getI18n } from "@/lib/i18n-server";

export default async function SetupPage() {
  if (await householdExists()) redirect("/login");
  setupToken(); // draws and logs the token as soon as the page is shown
  const { t } = await getI18n();
  return (
    <AuthShell
      title={t("Welcome to Foyra")}
      subtitle={t("Create your household and the administrator account. No data is created automatically.")}
      foot={t("You can then add household members from Settings › Members.")}
    >
      <ActionForm action={setupAction}>
        <Field
          name="setupToken" label={t("Setup token")}
          hint={t(process.env.SETUP_TOKEN ? "Value of the server’s SETUP_TOKEN variable." : "Shown in the server logs.")}
        >
          <input name="setupToken" type="password" required autoComplete="off" />
        </Field>
        <Field name="householdName" label={t("Household name")}><input name="householdName" required maxLength={100} /></Field>
        <Field name="name" label={t("Your first name")}><input name="name" required maxLength={100} autoComplete="given-name" /></Field>
        <Field name="email" label={t("Email")} hint={t("Your sign-in identifier.")}><input name="email" type="email" required autoComplete="email" /></Field>
        <Field name="password" label={t("Password")} hint={t("8 characters minimum.")}><input name="password" type="password" required minLength={8} autoComplete="new-password" /></Field>
        <button type="submit" className="mt-1 w-full">{t("Create the household")}</button>
      </ActionForm>
    </AuthShell>
  );
}
