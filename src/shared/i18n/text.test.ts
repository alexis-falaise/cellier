import { describe, expect, it } from 'vitest';
import { setActiveLocale } from './locale';
import { capitalize, compareNames, compareText, elide, fold } from './text';

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

describe('compareText', () => {
  it('sorts French names', () => {
    expect(['Œufs', 'eau', 'Épices', 'abricots', 'Été'].sort(compareText)).toEqual([
      'abricots',
      'eau',
      'Épices',
      'Été',
      'Œufs',
    ]);
  });

  it('sorts digits by value', () => {
    expect(['Lot 10', 'Lot 2'].sort(compareText)).toEqual(['Lot 2', 'Lot 10']);
  });
});

describe('other languages', () => {
  it('sorts Swedish å ä ö after z', () => {
    setActiveLocale('sv');
    try {
      expect(['Öl', 'Zucchini', 'Ägg', 'Apelsiner', 'Ål'].sort(compareText)).toEqual([
        'Apelsiner',
        'Zucchini',
        'Ål',
        'Ägg',
        'Öl',
      ]);
    } finally {
      setActiveLocale('fr');
    }
  });

  it('compares names without case or accents', () => {
    expect(compareNames('Épices', 'epices')).toBe(0);
  });

  it('folds Swedish letters for search', () => {
    expect(fold('Rödbetor')).toBe('rodbetor');
    expect(fold('Blåbär')).toBe('blabar');
  });
});

describe('capitalize and elide', () => {
  it('capitalizes the first letter only', () => {
    expect(capitalize('samedi 16 nov.')).toBe('Samedi 16 nov.');
    expect(capitalize('élan')).toBe('Élan');
    expect(capitalize('')).toBe('');
  });

  it('elides «de» before a vowel', () => {
    expect(elide('Au lieu de Avocats')).toBe('Au lieu d’Avocats');
    expect(elide('Au lieu de Tomates')).toBe('Au lieu de Tomates');
    expect(elide('Au lieu de Haricots verts')).toBe('Au lieu de Haricots verts');
  });
});
