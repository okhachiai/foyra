import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { createMemberAction } from "@/app/actions";
import { ActionForm, Field } from "@/app/form";
import { SettingsNav } from "@/app/nav";

export default async function MembersPage() {
  const admin = await requireAdmin();
  const members = await prisma.user.findMany({ where: { householdId: admin.householdId }, orderBy: { createdAt: "asc" } });
  return (
    <>
      <PageHeader
        eyebrow="Paramètres" title="Membres"
        subtitle="Tous les membres voient et saisissent budgets et opérations ; les administrateurs gèrent membres, catalogue et IA."
      />
      <SettingsNav admin />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card variant="table">
          <SectionHeader title="Membres du foyer" subtitle={`${members.length} membre${members.length > 1 ? "s" : ""}`} />
          <ul className="list !px-0">
            {members.map((m) => (
              <li key={m.id}>
                <Link href={`/members/${m.id}`}>
                  <span className="flex min-w-0 items-center gap-3">
                    <span className={`avatar size-10 text-sm ${m.disabledAt ? "bg-raised text-muted" : "bg-accent-tint text-accent-ink"}`} aria-hidden>{m.name.trim().charAt(0).toUpperCase()}</span>
                    <span className="min-w-0">{m.name}{m.id === admin.id && <span className="font-medium text-muted"> (vous)</span>}<small className="muted truncate">{m.email}</small></span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {m.disabledAt && <Badge tone="warning" dot>Désactivé</Badge>}
                    <Badge tone={m.role === "ADMIN" ? "success" : "muted"}>{m.role === "ADMIN" ? "Admin" : "Membre"}</Badge>
                    <Icon name="chevron" className="size-4 text-faint" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <SectionHeader title="Ajouter un membre" subtitle="Le membre change son mot de passe depuis Paramètres › Sécurité." />
          <ActionForm action={createMemberAction}>
            <Field name="name" label="Prénom"><input name="name" required maxLength={100} /></Field>
            <Field name="email" label="Email" hint="Identifiant de connexion."><input name="email" type="email" required autoComplete="off" /></Field>
            <Field name="password" label="Mot de passe provisoire" hint="8 caractères minimum, à transmettre au membre."><input name="password" type="password" required minLength={8} autoComplete="new-password" /></Field>
            <Field name="role" label="Rôle">
              <select name="role" defaultValue="MEMBER">
                <option value="MEMBER">Membre</option>
                <option value="ADMIN">Admin</option>
              </select>
            </Field>
            <div className="form-actions"><button type="submit">Créer le membre</button></div>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
