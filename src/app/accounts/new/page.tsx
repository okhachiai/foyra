import { requireUser } from "@/lib/auth";
import { AccountForm } from "../account-form";

export default async function NewAccountPage() {
  await requireUser();
  return (
    <>
      <h1>Nouveau compte</h1>
      <AccountForm />
    </>
  );
}
