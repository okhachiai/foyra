import { redirect } from "next/navigation";
import { householdExists } from "@/lib/auth";
import { AuthShell } from "@/components/ui/auth-shell";
import { SignInCard } from "@/components/ui/sign-in-card-2";
import { getI18n } from "@/lib/i18n-server";

export default async function LoginPage() {
  if (!(await householdExists())) redirect("/setup");
  const { t } = await getI18n();
  return (
    <AuthShell title={t("Sign in")} subtitle={t("Access your household’s budget and accounts.")} foot={t("Access is limited to household members, created by an administrator.")}>
      <SignInCard />
    </AuthShell>
  );
}
