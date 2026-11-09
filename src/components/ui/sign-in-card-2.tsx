"use client";

import { useState } from "react";
import { loginAction } from "@/app/actions";
import { ActionForm } from "@/app/form";
import { Icon } from "./icon";

const INPUT = "pl-10";
const ICON = "pointer-events-none absolute left-3 size-4 text-faint transition-colors group-focus-within/field:text-accent";
const FIELD = "group/field relative flex items-center";

/** Carte de connexion : carte blanche sur fond ivoire, branchée sur loginAction. */
export function SignInCard() {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="flex min-h-dvh w-full items-center justify-center bg-background px-4">
      <div className="card w-full max-w-sm p-6 transition duration-500 starting:translate-y-3 starting:opacity-0 sm:p-8">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="logo" aria-hidden>F</span>
          <div>
            <h1 className="m-0 text-2xl">Foyra</h1>
            <p className="m-0 mt-1 text-sm text-muted">Connectez-vous pour accéder aux comptes du foyer</p>
          </div>
        </div>

        <ActionForm action={loginAction} className="form group/form text-sm">
          <label className={FIELD}>
            <span className="sr-only">Email</span>
            <Icon name="mail" className={ICON} />
            <input name="email" type="email" required autoComplete="email" placeholder="Email" className={INPUT} />
          </label>

          <div className={FIELD}>
            <Icon name="lock" className={ICON} />
            <input
              name="password"
              type={showPassword ? "text" : "password"}
              required
              autoComplete="current-password"
              placeholder="Mot de passe"
              aria-label="Mot de passe"
              className={`${INPUT} pr-11`}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
              className="absolute right-1 min-h-0 border-0 bg-transparent p-2 text-faint hover:bg-transparent hover:text-heading"
            >
              <Icon name={showPassword ? "eye" : "eyeOff"} className="size-4" />
            </button>
          </div>

          <button type="submit" className="mt-2 w-full">
            <span className="hidden size-4 animate-spin rounded-full border-2 border-current border-t-transparent group-aria-busy/form:block" aria-hidden />
            <span className="group-aria-busy/form:hidden">Se connecter</span>
          </button>
        </ActionForm>
      </div>
    </div>
  );
}
