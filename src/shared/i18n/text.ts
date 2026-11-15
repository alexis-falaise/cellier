import { perLocale } from './locale';

/**
 * Folds a string for diacritic- and case-insensitive search:
 * «Œufs Crème brûlée» → «oeufs creme brulee», «Rödbetor» → «rodbetor».
 */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/[’‘]/g, "'");
}

const sortCollator = perLocale((tag) => new Intl.Collator(tag, { numeric: true }));
const baseCollator = perLocale((tag) => new Intl.Collator(tag, { sensitivity: 'base', numeric: true }));

/**
 * Sorts names as a dictionary of the active language does (French accents, Swedish å ä ö after z),
 * digits by value.
 */
export const compareText = (a: string, b: string): number => sortCollator().compare(a, b);

/** Same order, ignoring case and accents: «eau» and «Eau» are equal. */
export const compareNames = (a: string, b: string): number => baseCollator().compare(a, b);

/** «samedi 16 nov.» → «Samedi 16 nov.» (a date or a name standing alone as a title). */
export function capitalize(text: string): string {
  return text.length > 0 ? text.charAt(0).toLocaleUpperCase() + text.slice(1) : text;
}

/**
 * French elision of «de» before a vowel: «Au lieu de Avocats» → «Au lieu d’Avocats». A leading h is
 * left alone (most food names have an aspirated h). Other languages are returned unchanged.
 */
export function elide(text: string): string {
  return text.replace(/\bde (?=[aeiouyàâäéèêëîïôöùûüœæ])/gi, 'd’');
}
