import { describe, expect, it } from 'vitest';
import { compareFr, fold } from './text';

describe('fold', () => {
  it('removes diacritics and case', () => {
    expect(fold('Crème BRÛLÉE')).toBe('creme brulee');
    expect(fold('Épicerie sucrée')).toBe('epicerie sucree');
    expect(fold('Ça')).toBe('ca');
  });

  it('expands ligatures and normalizes apostrophes', () => {
    expect(fold('Œufs')).toBe('oeufs');
    expect(fold('Huile d’olive')).toBe("huile d'olive");
  });

  it('matches folded queries', () => {
    expect(fold('Pâtes, riz & céréales').includes(fold('CEREALE'))).toBe(true);
  });
});

describe('compareFr', () => {
  it('sorts French names', () => {
    expect(['Œufs', 'eau', 'Épices', 'abricots', 'Été'].sort(compareFr)).toEqual([
      'abricots',
      'eau',
      'Épices',
      'Été',
      'Œufs',
    ]);
  });

  it('sorts digits by value', () => {
    expect(['Lot 10', 'Lot 2'].sort(compareFr)).toEqual(['Lot 2', 'Lot 10']);
  });
});
