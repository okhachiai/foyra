"use client";

import { createContext, useActionState, useContext, useTransition, type ReactNode } from "react";

export type FormState = { error?: string; fields?: Record<string, string> };
type Action = (state: FormState, data: FormData) => Promise<FormState>;

const StateCtx = createContext<FormState>({});

/**
 * Formulaire branché sur une Server Action. Soumission via onSubmit (et non `action=`)
 * pour que React ne vide pas les champs quand l'action renvoie une erreur.
 */
export function ActionForm({ action, children, className, confirm }: { action: Action; children: ReactNode; className?: string; confirm?: string }) {
  const [state, formAction] = useActionState(action, {});
  const [pending, startTransition] = useTransition();
  return (
    <StateCtx.Provider value={state}>
      <form
        method="post"
        className={className ?? "form"}
        aria-busy={pending}
        onSubmit={(e) => {
          e.preventDefault();
          const submitter = (e.nativeEvent as SubmitEvent).submitter;
          // Confirmation propre au bouton (data-confirm), sinon celle du formulaire.
          const ask = submitter?.dataset.confirm ?? confirm;
          if (ask && !window.confirm(ask)) return;
          const data = new FormData(e.currentTarget, submitter);
          startTransition(() => formAction(data));
        }}
      >
        {state.error && <p className="error" role="alert">{state.error}</p>}
        <fieldset disabled={pending}>{children}</fieldset>
      </form>
    </StateCtx.Provider>
  );
}

/** Champ libellé + message d'erreur propre au champ. */
export function Field({ name, label, children }: { name: string; label: string; children: ReactNode }) {
  const error = useContext(StateCtx).fields?.[name];
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {error && <small className="error" role="alert">{error}</small>}
    </label>
  );
}

/** Case « commune » ; `sharedField` signale qu'elle était affichée (absente = choix laissé au serveur). */
export function SharedCheck({ label, checked }: { label: string; checked: boolean }) {
  return (
    <label className="check shared-check">
      <input type="hidden" name="sharedField" value="1" />
      <input type="checkbox" name="shared" defaultChecked={checked} />{label}
    </label>
  );
}
