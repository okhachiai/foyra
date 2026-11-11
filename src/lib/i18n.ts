import ar from "./i18n/ar";
import fr from "./i18n/fr";

/** UI languages. English is the source text (and the default); fr/ar map English strings to translations. */
export const LOCALES = ["en", "fr", "ar"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "foyra_lang";
/** Explicit light/dark choice; absent = follow the system. */
export const THEME_COOKIE = "foyra_theme";
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", fr: "Français", ar: "العربية" };

/** Intl tag used for numbers, currencies and dates (Arabic keeps Latin digits for amounts). */
export const INTL: Record<Locale, string> = { en: "en-GB", fr: "fr-FR", ar: "ar-u-nu-latn" };
export const DIR: Record<Locale, "ltr" | "rtl"> = { en: "ltr", fr: "ltr", ar: "rtl" };

export const DICTS: Record<Exclude<Locale, "en">, Record<string, string>> = { fr, ar };

export const toLocale = (v: string | undefined | null): Locale => (LOCALES as readonly string[]).includes(v ?? "") ? (v as Locale) : DEFAULT_LOCALE;

export type Vars = Record<string, string | number>;
export type T = (text: string, vars?: Vars) => string;

/** Translates an English source string, then fills `{name}` placeholders. Missing translation → English. */
export function translate(locale: Locale, text: string, vars?: Vars): string {
  const s = (locale === "en" ? undefined : DICTS[locale][text]) ?? text;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}

export const translator = (locale: Locale): T => (text, vars) => translate(locale, text, vars);
