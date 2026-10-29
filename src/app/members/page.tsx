import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createMemberAction } from "../actions";
import { ActionForm, Field } from "../form";

export default async function MembersPage() {
  const admin = await requireAdmin();
  const members = await prisma.user.findMany({ where: { householdId: admin.householdId }, orderBy: { createdAt: "asc" } });
  return (
    <>
      <h1>Membres du foyer</h1>
      <ul className="list">
        {members.map((m) => (
          <li key={m.id}>
            <Link href={`/members/${m.id}`}>
              <span>{m.name}<small className="muted">{m.email}</small></span>
              <span className="muted">{m.role === "ADMIN" ? "Admin" : "Membre"}{m.disabledAt ? " · désactivé" : ""}</span>
            </Link>
          </li>
        ))}
      </ul>
      <h2>Ajouter un membre</h2>
      <ActionForm action={createMemberAction}>
        <Field name="name" label="Prénom"><input name="name" required maxLength={100} /></Field>
        <Field name="email" label="Email"><input name="email" type="email" required autoComplete="off" /></Field>
        <Field name="password" label="Mot de passe provisoire (8 caractères min.)"><input name="password" type="password" required minLength={8} autoComplete="new-password" /></Field>
        <Field name="role" label="Rôle">
          <select name="role" defaultValue="MEMBER">
            <option value="MEMBER">Membre</option>
            <option value="ADMIN">Admin</option>
          </select>
        </Field>
        <button type="submit">Créer le membre</button>
      </ActionForm>
    </>
  );
}
