import { cache } from "react";
import { cookies } from "next/headers";
import { DIR, INTL, LOCALE_COOKIE, toLocale, translator } from "./i18n";

/** Language of the current request (cookie set from Settings or the login page), English by default. */
export const getI18n = cache(async () => {
  const locale = toLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return { locale, t: translator(locale), intl: INTL[locale], dir: DIR[locale] };
});
