import { redirect } from "next/navigation";
import { householdExists } from "@/lib/auth";
import { SignInCard } from "@/components/ui/sign-in-card-2";

export default async function LoginPage() {
  if (!(await householdExists())) redirect("/setup");
  return <SignInCard />;
}
