import { requireUser } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { changePasswordAction } from "@/app/actions";
import { ActionForm, Field } from "@/app/form";
import { SettingsNav } from "@/app/nav";

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ ok?: string }> }) {
  const user = await requireUser();
  const admin = user.role === "ADMIN";
  const ok = (await searchParams).ok === "1";
  return (
    <>
      <PageHeader eyebrow="Paramètres" title="Sécurité" subtitle="Votre compte et votre mot de passe." />
      <SettingsNav admin={admin} />
      {ok && <p role="status" className="alert success mb-4"><Icon name="shield" className="mt-0.5 size-4 shrink-0" />Mot de passe modifié. Vos autres sessions ont été fermées.</p>}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card>
          <SectionHeader title="Compte" />
          <div className="flex items-center gap-3">
            <span className="avatar size-12 shrink-0 bg-accent-tint text-lg text-accent-ink" aria-hidden>{user.name.trim().charAt(0).toUpperCase()}</span>
            <div className="min-w-0">
              <p className="m-0 truncate font-bold text-heading">{user.name}</p>
              <p className="m-0 truncate text-label text-muted">{user.email}</p>
            </div>
          </div>
          <div><Badge tone={admin ? "success" : "muted"}>{admin ? "Administrateur" : "Membre"}</Badge></div>
        </Card>

        <Card>
          <SectionHeader title="Changer le mot de passe" subtitle="Les autres sessions ouvertes seront fermées." />
          <ActionForm action={changePasswordAction}>
            <input type="text" name="username" autoComplete="username" value={user.email} readOnly hidden />
            <Field name="current" label="Mot de passe actuel"><input name="current" type="password" required autoComplete="current-password" /></Field>
            <Field name="password" label="Nouveau mot de passe" hint="8 caractères minimum."><input name="password" type="password" required minLength={8} autoComplete="new-password" /></Field>
            <Field name="confirm" label="Confirmation"><input name="confirm" type="password" required minLength={8} autoComplete="new-password" /></Field>
            <div className="form-actions"><button type="submit">Changer le mot de passe</button></div>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
