"use client";

import { useState } from "react";
import { loginAction } from "@/app/actions";
import { ActionForm } from "@/app/form";
import { Icon } from "./icon";

const ICON = "pointer-events-none absolute left-3 size-4 text-faint transition-colors group-focus-within/field:text-accent";
const LABEL = "text-label font-semibold text-heading";

/** Formulaire de connexion (dans AuthShell), branché sur loginAction ; libellés au-dessus des champs. */
export function SignInCard() {
  const [showPassword, setShowPassword] = useState(false);
  return (
    <ActionForm action={loginAction}>
      <div className="field">
        <label htmlFor="email" className={LABEL}>Email</label>
        <div className="group/field relative flex items-center">
          <Icon name="mail" className={ICON} />
          <input id="email" name="email" type="email" required autoComplete="email" placeholder="vous@exemple.fr" className="pl-10" />
        </div>
      </div>
      <div className="field">
        <label htmlFor="password" className={LABEL}>Mot de passe</label>
        <div className="group/field relative flex items-center">
          <Icon name="lock" className={ICON} />
          <input id="password" name="password" type={showPassword ? "text" : "password"} required autoComplete="current-password" className="pr-11 pl-10" />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
            aria-pressed={showPassword}
            className="absolute right-0.5 border-0 bg-transparent px-3 text-faint hover:bg-transparent hover:text-heading"
          >
            <Icon name={showPassword ? "eye" : "eyeOff"} className="size-4" />
          </button>
        </div>
      </div>
      <button type="submit" className="mt-1 w-full">Se connecter</button>
    </ActionForm>
  );
}
