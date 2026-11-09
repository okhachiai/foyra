"use client";

import { cloneElement, createContext, isValidElement, useActionState, useContext, useEffect, useId, useRef, useState, useTransition, type ReactElement, type ReactNode } from "react";
import { Icon } from "@/components/ui/icon";

export type FormState = { error?: string; notice?: string; fields?: Record<string, string> };
type Action = (state: FormState, data: FormData) => Promise<FormState>;
type Ask = { text: string; label: string; danger: boolean; data: FormData };

const StateCtx = createContext<FormState>({});

/**
 * Formulaire branché sur une Server Action. Soumission via onSubmit (et non `action=`)
 * pour que React ne vide pas les champs quand l'action renvoie une erreur.
 * `confirm` (ou `data-confirm` sur le bouton) : boîte de confirmation (<dialog> natif : Échap, focus piégé)
 * dont le bouton reprend le libellé et le ton (danger) du bouton cliqué.
 */
export function ActionForm({ action, children, className, confirm, pendingNotice }: { action: Action; children: ReactNode; className?: string; confirm?: string; pendingNotice?: string }) {
  // Coupure réseau pendant l'appel (serveur relancé, réponse trop longue pour le navigateur) : fetch lève TypeError.
  // On l'affiche dans le formulaire au lieu de faire tomber la page ; les autres erreurs (redirections Next…) passent.
  const [state, formAction] = useActionState(async (s: FormState, d: FormData) => {
    try {
      return await action(s, d);
    } catch (e) {
      if (e instanceof TypeError) return { error: "Connexion au serveur interrompue. L’opération a pu aboutir : vérifier avant de réessayer (les analyses IA apparaissent dans Rapports)." };
      throw e;
    }
  }, {});
  const [pending, startTransition] = useTransition();
  const [ask, setAsk] = useState<Ask | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const askId = useId();
  useEffect(() => { if (ask) dialog.current?.showModal(); }, [ask]);
  const submit = (data: FormData) => startTransition(() => formAction(data));

  return (
    <StateCtx.Provider value={state}>
      <form
        method="post"
        className={className ?? "form"}
        aria-busy={pending}
        onSubmit={(e) => {
          e.preventDefault();
          const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
          const data = new FormData(e.currentTarget, submitter);
          // Confirmation propre au bouton (data-confirm), sinon celle du formulaire.
          const text = submitter?.dataset.confirm ?? confirm;
          if (!text) return submit(data);
          setAsk({ text, data, label: submitter?.textContent?.trim() || "Confirmer", danger: !!submitter?.classList.contains("danger") });
        }}
      >
        {state.error && <p className="alert danger error whitespace-pre-line" role="alert"><Icon name="alert" className="mt-0.5 size-4 shrink-0" />{state.error}</p>}
        {state.notice && <p className="alert success whitespace-pre-line" role="status"><Icon name="shield" className="mt-0.5 size-4 shrink-0" />{state.notice}</p>}
        <fieldset disabled={pending}>{children}</fieldset>
        {pending && pendingNotice && (
          <p className="m-0 flex items-center gap-2 text-sm text-muted" role="status">
            <span className="spinner" aria-hidden />
            {pendingNotice}
          </p>
        )}
      </form>
      {ask && (
        <dialog ref={dialog} className="confirm" aria-label="Confirmation" aria-describedby={askId} onClose={() => setAsk(null)}>
          <h2 className="confirm-title">{ask.danger ? <Icon name="alert" className="size-5 shrink-0 text-neg" /> : null}Confirmation</h2>
          <p id={askId} className="confirm-text">{ask.text}</p>
          <div className="form-actions">
            <button type="button" className="secondary" autoFocus onClick={() => dialog.current?.close()}>Annuler</button>
            <button type="button" className={ask.danger ? "danger solid" : undefined} onClick={() => { dialog.current?.close(); submit(ask.data); }}>{ask.label}</button>
          </div>
        </dialog>
      )}
    </StateCtx.Provider>
  );
}

/**
 * Champ : libellé au-dessus, aide contextuelle (`hint`) puis erreur propre au champ en dessous.
 * Aide et erreur sont reliées au contrôle (aria-describedby, aria-invalid) hors du <label>,
 * pour ne pas allonger son nom accessible.
 */
export function Field({ name, label, hint, children }: { name: string; label: string; hint?: ReactNode; children: ReactNode }) {
  const error = useContext(StateCtx).fields?.[name];
  const id = useId();
  const described = [hint && `${id}-h`, error && `${id}-e`].filter(Boolean).join(" ") || undefined;
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, { "aria-describedby": described, "aria-invalid": error ? true : undefined })
    : children;
  return (
    <div className="field">
      <label>
        <span>{label}</span>
        {control}
      </label>
      {hint && <small id={`${id}-h`} className="hint">{hint}</small>}
      {error && <small id={`${id}-e`} className="error" role="alert">{error}</small>}
    </div>
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
