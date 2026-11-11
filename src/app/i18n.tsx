"use client";

import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_LOCALE, INTL, translator, type Locale } from "@/lib/i18n";

const Ctx = createContext<Locale>(DEFAULT_LOCALE);

/** Gives client components the request language (set by the root layout). */
export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <Ctx.Provider value={locale}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const locale = useContext(Ctx);
  return { locale, t: translator(locale), intl: INTL[locale] };
}
