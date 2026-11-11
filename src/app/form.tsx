"use client";

import { cloneElement, createContext, isValidElement, useActionState, useContext, useEffect, useId, useRef, useState, useTransition, type ReactElement, type ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import { useI18n } from "./i18n";

export type FormState = { error?: string; notice?: string; fields?: Record<string, string> };
type Action = (state: FormState, data: FormData) => Promise<FormState>;
type Ask = { text: string; label: string; danger: boolean; data: FormData };

const StateCtx = createContext<FormState>({});

/**
 * Form wired to a Server Action. Submitted via onSubmit (not `action=`)
 * so React does not clear the fields when the action returns an error.
 * `confirm` (or `data-confirm` on the button): confirmation box (native <dialog>: Escape, trapped focus)
 * whose button reuses the label and tone (danger) of the clicked button.
 * Server messages are English source text, translated here line by line; `confirm` is translated by the caller.
 */
export function ActionForm({ action, children, className, confirm, pendingNotice }: { action: Action; children: ReactNode; className?: string; confirm?: string; pendingNotice?: string }) {
  // Network cut during the call (server restarted, response too long for the browser): fetch throws TypeError.
  // Shown in the form instead of crashing the page; other errors (Next redirects…) pass through.
  const [state, formAction] = useActionState(async (s: FormState, d: FormData) => {
    try {
      return await action(s, d);
    } catch (e) {
      if (e instanceof TypeError) return { error: "Connection to the server was interrupted. The operation may have gone through: check before trying again (AI analyses appear in Reports)." };
      throw e;
    }
  }, {});
  const { t } = useI18n();
  const tr = (msg: string) => msg.split("\n").map((line) => t(line)).join("\n");
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
          // The button's own confirmation (data-confirm), else the form's.
          const text = submitter?.dataset.confirm ?? confirm;
          if (!text) return submit(data);
          setAsk({ text, data, label: submitter?.textContent?.trim() || t("Confirm"), danger: !!submitter?.classList.contains("danger") });
        }}
      >
        {state.error && <p className="alert danger error whitespace-pre-line" role="alert"><Icon name="alert" className="mt-0.5 size-4 shrink-0" />{tr(state.error)}</p>}
        {state.notice && <p className="alert success whitespace-pre-line" role="status"><Icon name="shield" className="mt-0.5 size-4 shrink-0" />{tr(state.notice)}</p>}
        <fieldset disabled={pending}>{children}</fieldset>
        {pending && pendingNotice && (
          <p className="m-0 flex items-center gap-2 text-sm text-muted" role="status">
            <span className="spinner" aria-hidden />
            {pendingNotice}
          </p>
        )}
      </form>
      {ask && (
        <dialog ref={dialog} className="confirm" aria-label={t("Confirmation")} aria-describedby={askId} onClose={() => setAsk(null)}>
          <h2 className="confirm-title">{ask.danger ? <Icon name="alert" className="size-5 shrink-0 text-neg" /> : null}{t("Confirmation")}</h2>
          <p id={askId} className="confirm-text">{ask.text}</p>
          <div className="form-actions">
            <button type="button" className="secondary" autoFocus onClick={() => dialog.current?.close()}>{t("Cancel")}</button>
            <button type="button" className={ask.danger ? "danger solid" : undefined} onClick={() => { dialog.current?.close(); submit(ask.data); }}>{ask.label}</button>
          </div>
        </dialog>
      )}
    </StateCtx.Provider>
  );
}

/**
 * Field: label above, contextual help (`hint`) then the field's own error below.
 * Help and error are linked to the control (aria-describedby, aria-invalid) outside the <label>,
 * so its accessible name stays short.
 */
export function Field({ name, label, hint, children }: { name: string; label: string; hint?: ReactNode; children: ReactNode }) {
  const raw = useContext(StateCtx).fields?.[name];
  const { t } = useI18n();
  const error = raw && t(raw);
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

/** "Shared" checkbox; `sharedField` signals it was shown (absent = choice left to the server). */
export function SharedCheck({ label, checked }: { label: string; checked: boolean }) {
  return (
    <label className="check shared-check">
      <input type="hidden" name="sharedField" value="1" />
      <input type="checkbox" name="shared" defaultChecked={checked} />{label}
    </label>
  );
}
