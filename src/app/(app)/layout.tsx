import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { logoutAction } from "@/app/actions";
import { Crumbs, Nav } from "@/app/nav";
import { Icon } from "@/components/ui/icon";

/** Coquille des pages connectées (groupe de routes (app)) : barre latérale + barre du haut. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="app">
      <aside className="side">
        <Link href="/tableau-de-bord" className="brand"><span className="logo" aria-hidden>F</span>Foyra</Link>
        <Nav />
        <form action={logoutAction}>
          <button type="submit" className="link"><Icon name="logout" />Déconnexion</button>
        </form>
      </aside>
      <div className="shell">
        <header className="topbar">
          <Crumbs root={user.household.name} />
          <span className="who">
            <span className="avatar" aria-hidden>{user.name.trim().charAt(0).toUpperCase()}</span>
            <span className="who-name">{user.name}</span>
          </span>
        </header>
        <main>{children}</main>
      </div>
    </div>
  );
}
