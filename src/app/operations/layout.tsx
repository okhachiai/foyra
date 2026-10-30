import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { logoutAction } from "../actions";
import { Nav } from "../nav";

/** Barre latérale commune aux pages connectées (réutilisée par /operations, /tableau-de-bord, /epargne, /parametres, /members, /categories, /budget, /rapports, /charges, /credits, /calendrier et /profil). */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="app">
      <aside className="side">
        <Link href="/tableau-de-bord" className="brand">{user.household.name}</Link>
        <Nav />
        <form action={logoutAction}>
          <button type="submit" className="link">Déconnexion</button>
        </form>
      </aside>
      <main>{children}</main>
    </div>
  );
}
