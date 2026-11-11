import { setLocaleAction } from "@/app/actions";
import { getI18n } from "@/lib/i18n-server";
import { LOCALE_NAMES, LOCALES } from "@/lib/i18n";

/** Language picker: one submit button per language (works without JavaScript); the choice is kept in a cookie. */
export async function LanguageSwitch({ className }: { className?: string }) {
  const { locale, t } = await getI18n();
  return (
    <form action={setLocaleAction} className={className}>
      <div className="subnav" role="group" aria-label={t("Language")}>
        {LOCALES.map((l) => (
          <button key={l} type="submit" name="locale" value={l} lang={l} aria-pressed={l === locale} className={l === locale ? "secondary" : "ghost"}>
            {LOCALE_NAMES[l]}
          </button>
        ))}
      </div>
    </form>
  );
}
