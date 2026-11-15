/**
 * The language of the interface. One locale is active for the whole page: it is read once at start
 * (the choice stored on this device, else the device language) and changing it reloads the app, so
 * module-level strings and cached formatters never mix two languages.
 */

export const LOCALES = ['fr', 'en', 'sv'] as const;
export type Locale = (typeof LOCALES)[number];

/** BCP 47 tag used with `Intl` for each language (euros, metric units, 24-hour clock everywhere). */
export const INTL_TAG: Record<Locale, string> = { fr: 'fr-FR', en: 'en-GB', sv: 'sv-SE' };

/** Each language named in itself, as shown in the picker. */
export const LOCALE_NAMES: Record<Locale, string> = { fr: 'Français', en: 'English', sv: 'Svenska' };

/** Used when the device speaks none of the supported languages. */
export const FALLBACK_LOCALE: Locale = 'en';

const STORAGE_KEY = 'cellier.locale';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** First supported language among the device's preferred ones («sv-SE» → sv), else English. */
export function detectLocale(languages?: readonly string[]): Locale {
  const nav = globalThis.navigator as Navigator | undefined;
  const list = languages ?? nav?.languages ?? (nav?.language ? [nav.language] : []);
  for (const tag of list) {
    const base = tag.toLowerCase().split('-')[0];
    if (isLocale(base)) return base;
  }
  return FALLBACK_LOCALE;
}

/** The language chosen on this device, or null when it still follows the device language. */
export function readStoredLocale(): Locale | null {
  try {
    const value = globalThis.localStorage?.getItem(STORAGE_KEY);
    return isLocale(value) ? value : null;
  } catch {
    return null;
  }
}

export function storeLocale(locale: Locale): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, locale);
  } catch {
    // Private mode or blocked storage: the choice lasts for the session only.
  }
}

let active: Locale = readStoredLocale() ?? detectLocale();

export function getLocale(): Locale {
  return active;
}

/** `Intl` tag of the active language. */
export function intlTag(): string {
  return INTL_TAG[active];
}

/**
 * Switches the active language in memory. The app calls it before a reload; tests call it to pin a
 * language. Components already rendered keep their strings until they are mounted again.
 */
export function setActiveLocale(locale: Locale): void {
  active = locale;
  applyDocumentLocale();
}

/** `<html lang>` follows the active language (hyphenation, VoiceOver voice, spell-check). */
export function applyDocumentLocale(): void {
  if (typeof document !== 'undefined') document.documentElement.lang = active;
}

/**
 * A value built once per language, on first use: `Intl` formatters, collators, lookup tables.
 *
 *   const euro = perLocale((tag) => new Intl.NumberFormat(tag, { style: 'currency', currency: 'EUR' }));
 *   euro().format(1.89);
 */
export function perLocale<T>(make: (tag: string, locale: Locale) => T): () => T {
  const cache = new Map<Locale, T>();
  return () => {
    const cached = cache.get(active);
    if (cached !== undefined) return cached;
    const value = make(INTL_TAG[active], active);
    cache.set(active, value);
    return value;
  };
}
