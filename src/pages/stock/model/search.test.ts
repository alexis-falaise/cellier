import { describe, expect, it } from 'vitest';
import { createStockSearch, toSearchDoc } from './search';

const docs = [
  { id: 'p1', name: 'Œufs frais', brand: 'Loué', gtin: '03266980000016', categoryName: 'Frais' },
  { id: 'p2', name: 'Pâtes complètes', brand: 'Barilla', gtin: null, categoryName: 'Épicerie' },
  { id: 'p3', name: 'Crème fraîche', brand: null, gtin: '3033490004743', categoryName: 'Frais' },
  { id: 'p4', name: 'Café moulu', brand: 'Carte Noire', gtin: null, categoryName: 'Petit-déjeuner' },
].map(toSearchDoc);

const search = createStockSearch(docs);

describe('stock search', () => {
  it('folds accents and ligatures both ways', () => {
    expect(search.search('oeufs')).toEqual(['p1']);
    expect(search.search('PATES')).toEqual(['p2']);
    expect(search.search('crème')).toEqual(['p3']);
    expect(search.search('cafe')).toEqual(['p4']);
  });

  it('matches prefixes and requires every word', () => {
    expect(search.search('pat comp')).toEqual(['p2']);
    expect(search.search('pat fraiche')).toEqual([]);
  });

  it('searches brand, category and barcode, with or without leading zeros', () => {
    expect(search.search('barilla')).toEqual(['p2']);
    expect(search.search('frais').sort()).toEqual(['p1', 'p3']);
    expect(search.search('3266980000016')).toEqual(['p1']);
    expect(search.search('03266980000016')).toEqual(['p1']);
  });

  it('tolerates a typo in longer words only', () => {
    expect(search.search('complettes')).toEqual(['p2']);
    expect(search.search('caf')).toEqual(['p4']);
  });

  it('returns nothing for a blank query', () => {
    expect(search.search('   ')).toEqual([]);
  });

  it('ranks name matches above category matches', () => {
    const s = createStockSearch(
      [
        { id: 'a', name: 'Yaourt', brand: null, gtin: null, categoryName: 'Frais' },
        { id: 'b', name: 'Fraises', brand: null, gtin: null, categoryName: 'Fruits' },
      ].map(toSearchDoc),
    );
    expect(s.search('frais')[0]).toBe('b');
  });
});
