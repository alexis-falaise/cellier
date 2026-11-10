/** U+00A0, before `:`. */
export const NBSP = ' ';
/** U+202F, before `; ! ? %`, inside « », after ≈ ×, between a number and its unit. */
export const NNBSP = ' ';

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
