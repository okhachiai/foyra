import { redirect } from "next/navigation";
import { householdExists } from "@/lib/auth";
import { AuthShell } from "@/components/ui/auth-shell";
import { SignInCard } from "@/components/ui/sign-in-card-2";

export default async function LoginPage() {
  if (!(await householdExists())) redirect("/setup");
  return (
    <AuthShell title="Connexion" subtitle="Accédez au budget et aux comptes de votre foyer." foot="Accès réservé aux membres du foyer, créés par un administrateur.">
      <SignInCard />
    </AuthShell>
  );
}
