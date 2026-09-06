import i18n from 'i18next';
import { defaultLocale } from './types';
import { supportedLocales } from './locales';

/**
 * Server-side i18next instance without React integration.
 * Used by server components that need translation without
 * the client-side React context.
 */
const serverI18n = i18n.createInstance();

// Initialize with the same config as the client-side instance
serverI18n.init({
  lng: defaultLocale,
  fallbackLng: defaultLocale,
  supportedLngs: supportedLocales.map((l) => l.code),
  interpolation: {
    escapeValue: false,
  },
  resources: {},
});

/**
 * Server-side translate function.
 * Loads locale resources on demand and caches them.
 */
const loadedLocales = new Set<string>();

export async function serverTranslate(locale: string, key: string): Promise<string> {
  // Load locale resources if not already loaded
  if (!loadedLocales.has(locale)) {
    try {
      const localeModule = await import(`./locales/${locale}.json`);
      serverI18n.addResourceBundle(locale, 'translation', localeModule.default);
      loadedLocales.add(locale);
    } catch {
      // If locale file not found, fallback to default
      if (locale !== defaultLocale && !loadedLocales.has(defaultLocale)) {
        const defaultModule = await import(`./locales/${defaultLocale}.json`);
        serverI18n.addResourceBundle(defaultLocale, 'translation', defaultModule.default);
        loadedLocales.add(defaultLocale);
      }
    }
  }

  return serverI18n.t(key, { lng: locale });
}
