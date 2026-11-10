/**
 * Folds a string for diacritic- and case-insensitive search:
 * «Œufs Crème brûlée» → «oeufs creme brulee».
 */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('fr')
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/[’‘]/g, "'");
}

/** French collation for sorting names: accents ordered as in a French dictionary, digits by value. */
export const collator = new Intl.Collator('fr', { numeric: true });

export const compareFr = (a: string, b: string): number => collator.compare(a, b);
