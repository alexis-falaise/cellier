import type { Locale } from './locale';

/** U+00A0, before `:`. */
export const NBSP = '\u00a0';
/** U+202F, before `; ! ? %`, inside « », after ≈ ×, between a number and its unit. */
export const NNBSP = '\u202f';

const UNIT = '(?:j|sem\\.|min|h|€|g|kg|ml|cl|L)';

/**
 * Applies French typographic spacing to a string written with ordinary spaces.
 * Idempotent: already-correct strings are returned unchanged.
 */
export function frenchTypography(text: string): string {
  return text
    .replace(/ :/g, `${NBSP}:`)
    .replace(/ ([;!?%])/g, `${NNBSP}$1`)
    .replace(/« /g, `«${NNBSP}`)
    .replace(/ »/g, `${NNBSP}»`)
    .replace(/([≈×]) /g, `$1${NNBSP}`)
    .replace(new RegExp(`([\\d}]) (${UNIT})(?![\\p{L}\\d])`, 'gu'), `$1${NNBSP}$2`);
}

/** Units and abbreviations a number must not be separated from, per language. */
const UNITS: Record<Exclude<Locale, 'fr'>, string> = {
  en: '(?:d|wk|min|am|pm|g|kg|ml|cl|L|%)',
  sv: '(?:d|v|min|€|g|kg|ml|cl|L|%)',
};

/**
 * English and Swedish: no space before punctuation, so only the spaces that must not break are
 * replaced (after ≈ × <, between a number and its unit, Swedish «kl. 18»).
 */
function unbreakableSpaces(locale: Exclude<Locale, 'fr'>, text: string): string {
  return text
    .replace(/([≈×<]) /g, `$1${NNBSP}`)
    .replace(/\bkl\. (?=[\d{])/g, `kl.${NBSP}`)
    .replace(new RegExp(`([\\d}]) (${UNITS[locale]})(?![\\p{L}\\d])`, 'gu'), `$1${NNBSP}$2`);
}

/** A catalogue string written with ordinary spaces, with the typographic spaces of its language. */
export function typeset(locale: Locale, text: string): string {
  return locale === 'fr' ? frenchTypography(text) : unbreakableSpaces(locale, text);
}
