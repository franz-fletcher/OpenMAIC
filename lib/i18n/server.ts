import { cookies, headers } from 'next/headers';
import { defaultLocale, type Locale } from './types';
import { supportedLocales } from './locales';

/**
 * Resolve the locale for a server component from the request.
 *
 * Precedence:
 * 1. `NEXT_LOCALE` cookie (set by the language switcher or middleware)
 * 2. `Accept-Language` header (first supported match)
 * 3. Default locale (`zh-CN`)
 */
export async function resolveServerLocale(): Promise<Locale> {
  // 1. Check cookie
  const cookieStore = await cookies();
  const nextLocale = cookieStore.get('NEXT_LOCALE')?.value;
  if (nextLocale && isSupportedLocale(nextLocale)) {
    return nextLocale;
  }

  // 2. Check Accept-Language header
  const headersStore = await headers();
  const acceptLanguage = headersStore.get('accept-language');
  if (acceptLanguage) {
    const parsed = parseAcceptLanguage(acceptLanguage);
    for (const lang of parsed) {
      if (isSupportedLocale(lang)) {
        return lang;
      }
      // Try prefix match (e.g., 'en' → 'en-US')
      const prefix = lang.split('-')[0].toLowerCase();
      const match = supportedLocales.find((l) => l.code.toLowerCase().startsWith(prefix));
      if (match) {
        return match.code;
      }
    }
  }

  // 3. Default
  return defaultLocale;
}

function isSupportedLocale(code: string): code is Locale {
  return supportedLocales.some((l) => l.code === code);
}

/**
 * Parse Accept-Language header into an array of language codes,
 * sorted by quality value (descending).
 */
function parseAcceptLanguage(header: string): string[] {
  return header
    .split(',')
    .map((part) => {
      const [lang, qPart] = part.trim().split(';');
      const q = qPart ? parseFloat(qPart.replace('q=', '')) : 1;
      return { lang: lang.trim(), q };
    })
    .sort((a, b) => b.q - a.q)
    .map((item) => item.lang);
}
