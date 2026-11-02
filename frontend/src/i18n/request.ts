import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";

import { getCurrentUser } from "@/lib/auth";

const locales = ["en", "vi"] as const;

export type AppLocale = (typeof locales)[number];

function isLocale(value: string | undefined): value is AppLocale {
  return locales.includes(value as AppLocale);
}

/** First tag the browser asks for that we speak; English when none do. */
function fromAcceptLanguage(header: string | null): AppLocale {
  for (const tag of (header ?? "").split(",")) {
    const base = tag.trim().split(";")[0].split("-")[0].toLowerCase();
    if (isLocale(base)) return base;
  }
  return "en";
}

export default getRequestConfig(async () => {
  // The User's saved language wins so it follows them to a new device; the cookie covers signed-out pages.
  const preferred = (await getCurrentUser())?.locale ?? (await cookies()).get("NEXT_LOCALE")?.value;
  const locale = isLocale(preferred) ? preferred : fromAcceptLanguage((await headers()).get("accept-language"));

  return { locale, messages: (await import(`../../messages/${locale}.json`)).default };
});
