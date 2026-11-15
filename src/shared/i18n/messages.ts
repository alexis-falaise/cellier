import { en } from './en';
import { type Catalogue, type Entry, frSource, type MessageKey, type ParamsArg } from './fr';
import { getLocale, type Locale, perLocale } from './locale';
import { sv } from './sv';
import { typeset } from './typography';

const SOURCES: Record<Locale, Catalogue> = { fr: frSource, en, sv };

type Typeset = { readonly [K in MessageKey]: Entry };

const loaded = new Map<Locale, Typeset>();

/** A language's catalogue with its typographic spaces applied (built on first use). */
export function catalogue(locale: Locale): Typeset {
  let entries = loaded.get(locale);
  if (!entries) {
    entries = Object.fromEntries(
      Object.entries(SOURCES[locale]).map(([key, entry]) => [
        key,
        typeof entry === 'string'
          ? typeset(locale, entry)
          : { one: typeset(locale, entry.one), other: typeset(locale, entry.other) },
      ]),
    ) as Typeset;
    loaded.set(locale, entries);
  }
  return entries;
}

/** The French catalogue, whatever the active language (default names stored by the server are French). */
export const fr: Typeset = catalogue('fr');

const pluralRules = perLocale((tag) => new Intl.PluralRules(tag));
const numberFormat = perLocale((tag) => new Intl.NumberFormat(tag, { maximumFractionDigits: 2 }));

/** Which numeric parameter drives the plural; the deck uses `n` except where noted. */
const PLURAL_PARAMS = ['n', 'applied', 'k', 'd', 'w', 'u'] as const;

/** `one` for 0 and 1 in French, for 1 only in English and Swedish. */
export function pluralForm(count: number): 'one' | 'other' {
  return pluralRules().select(count) === 'one' ? 'one' : 'other';
}

/**
 * Looks up a string in the active language and fills `{name}` placeholders.
 * Numbers are formatted with `Intl`; pass identifiers such as barcodes as strings.
 */
export function t<K extends MessageKey>(key: K, ...args: ParamsArg<K>): string {
  const params = args[0] as Record<string, string | number> | undefined;
  const entry: Entry | undefined = catalogue(getLocale())[key] ?? fr[key];
  if (entry === undefined) return key;
  let text: string;
  if (typeof entry === 'string') {
    text = entry;
  } else {
    const driver = PLURAL_PARAMS.find((name) => typeof params?.[name] === 'number');
    const count = driver ? (params?.[driver] as number) : undefined;
    text = count === undefined ? entry.other : entry[pluralForm(count)];
  }
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    if (value === undefined) return match;
    return typeof value === 'number' ? numberFormat().format(value) : value;
  });
}

/** True when `key` is a catalogue key (for keys built from data, such as an Open Food Facts tag). */
export function isMessageKey(key: string): key is MessageKey {
  return Object.hasOwn(frSource, key);
}
