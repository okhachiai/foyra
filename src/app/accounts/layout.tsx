import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { logoutAction } from "../actions";

/** En-tête commun aux pages connectées (réutilisé par /members). */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <>
      <header className="top">
        <Link href="/accounts" className="brand">{user.household.name}</Link>
        <nav>
          <Link href="/accounts">Comptes</Link>
          {user.role === "ADMIN" && <Link href="/members">Membres</Link>}
          <form action={logoutAction}>
            <button type="submit" className="link">Déconnexion</button>
          </form>
        </nav>
      </header>
      <main>{children}</main>
    </>
  );
}
