import { describe, expect, it } from 'vitest';
import {
  addedBucket,
  buildStockRows,
  effectiveSort,
  type GroupLabels,
  indexLetter,
  priceBucket,
  quantityBucket,
  type StockItem,
  type StockViewOptions,
  stockComparator,
} from './stockList';

const labels: GroupLabels = {
  noCategory: 'Sans catégorie',
  added: { today: 'Aujourd’hui', week: 'Cette semaine', month: 'Ce mois-ci', older: 'Plus ancien' },
  price: { lt2: '<2', from2to5: '2-5', from5to10: '5-10', gt10: '>10', unknown: '?' },
  quantity: { zero: '0', one: '1', from2to5: '2-5', from6to11: '6-11', from12: '12+' },
};

function item(id: string, name: string, extra: Partial<StockItem> = {}): StockItem {
  return {
    id,
    name,
    categoryId: null,
    categoryOrder: 0,
    categoryName: null,
    quantity: 1,
    priceCents: null,
    lastAddedAt: null,
    low: false,
    ...extra,
  };
}

const view = (o: Partial<StockViewOptions>): StockViewOptions => ({
  group: 'item',
  sort: 'name',
  dir: 'asc',
  showEmpty: true,
  ...o,
});

const NOW = new Date(2026, 10, 12, 15, 0).getTime(); // Thursday 12 Nov 2026

const names = (rows: ReturnType<typeof buildStockRows>['rows']) =>
  rows.flatMap((r) => (r.kind === 'item' ? [r.item.name] : []));

describe('stockComparator', () => {
  it('sorts names with French collation, accents folded and numbers natural', () => {
    const list = [item('1', 'Œufs'), item('2', 'épinards'), item('3', 'Eau'), item('4', 'Riz 10'), item('5', 'Riz 2')];
    list.sort(stockComparator('name', 'asc'));
    expect(list.map((i) => i.name)).toEqual(['Eau', 'épinards', 'Œufs', 'Riz 2', 'Riz 10']);
  });

  it('puts the highest price first and unknown prices last in both directions', () => {
    const list = [item('a', 'A', { priceCents: 100 }), item('b', 'B'), item('c', 'C', { priceCents: 500 })];
    expect([...list].sort(stockComparator('price', 'asc')).map((i) => i.id)).toEqual(['c', 'a', 'b']);
    expect([...list].sort(stockComparator('price', 'desc')).map((i) => i.id)).toEqual(['a', 'c', 'b']);
  });

  it('puts the latest addition first and never-added items last', () => {
    const list = [item('a', 'A', { lastAddedAt: 1 }), item('b', 'B'), item('c', 'C', { lastAddedAt: 5 })];
    expect([...list].sort(stockComparator('recent', 'asc')).map((i) => i.id)).toEqual(['c', 'a', 'b']);
    expect([...list].sort(stockComparator('recent', 'desc')).map((i) => i.id)).toEqual(['a', 'c', 'b']);
  });

  it('puts the lowest quantity first, ties by name', () => {
    const list = [
      item('a', 'Pâtes', { quantity: 3 }),
      item('b', 'Café', { quantity: 0 }),
      item('c', 'Ail', { quantity: 3 }),
    ];
    expect(list.sort(stockComparator('quantity', 'asc')).map((i) => i.name)).toEqual(['Café', 'Ail', 'Pâtes']);
  });
});

describe('buckets', () => {
  it('maps prices, quantities and dates to their groups', () => {
    expect([null, 199, 200, 999, 1000].map(priceBucket)).toEqual(['unknown', 'lt2', 'from2to5', 'from5to10', 'gt10']);
    expect([0, 1, 5, 6, 11, 12].map(quantityBucket)).toEqual([
      'zero',
      'one',
      'from2to5',
      'from6to11',
      'from6to11',
      'from12',
    ]);
    expect(addedBucket(NOW - 3_600_000, NOW)).toBe('today');
    expect(addedBucket(new Date(2026, 10, 9, 8).getTime(), NOW)).toBe('week'); // Monday
    expect(addedBucket(new Date(2026, 10, 2).getTime(), NOW)).toBe('month');
    expect(addedBucket(new Date(2026, 9, 30).getTime(), NOW)).toBe('older');
    expect(addedBucket(null, NOW)).toBe('older');
  });

  it('folds index letters and sends symbols to #', () => {
    expect(['Éclairs', 'œufs', '7up', ' riz'].map(indexLetter)).toEqual(['E', 'O', '#', 'R']);
  });

  it('falls back to the name sort under category grouping', () => {
    expect(effectiveSort('category', 'category')).toBe('name');
    expect(effectiveSort('item', 'category')).toBe('category');
  });
});

describe('buildStockRows', () => {
  const items = [
    item('1', 'Riz', { quantity: 2, categoryId: 'c2', categoryOrder: 20, categoryName: 'Épicerie' }),
    item('2', 'Lait', { quantity: 0, categoryId: 'c1', categoryOrder: 10, categoryName: 'Frais' }),
    item('3', 'Beurre', { quantity: 1, categoryId: 'c1', categoryOrder: 10, categoryName: 'Frais' }),
    item('4', 'Sel', { quantity: 5 }),
  ];

  it('groups by category in household order with counts, «Sans catégorie» last', () => {
    const { rows, itemCount, unitCount } = buildStockRows(items, view({ group: 'category' }), labels, NOW);
    const headers = rows.flatMap((r) => (r.kind === 'header' ? [`${r.title}:${r.count}`] : []));
    expect(headers).toEqual(['Frais:2', 'Épicerie:1', 'Sans catégorie:1']);
    expect(names(rows)).toEqual(['Beurre', 'Lait', 'Riz', 'Sel']);
    expect(itemCount).toBe(4);
    expect(unitCount).toBe(8);
    expect(rows[0]).toMatchObject({ kind: 'header', first: true });
  });

  it('uses letter headers for «Article» sorted by name, and hides empty items on request', () => {
    const { rows } = buildStockRows(items, view({ showEmpty: false }), labels, NOW);
    expect(rows.filter((r) => r.kind === 'header').map((r) => r.key)).toEqual(['letter:B', 'letter:R', 'letter:S']);
    expect(names(rows)).toEqual(['Beurre', 'Riz', 'Sel']);
  });

  it('is one flat list for «Article» with another sort', () => {
    const { rows } = buildStockRows(items, view({ sort: 'quantity', dir: 'desc' }), labels, NOW);
    expect(rows.every((r) => r.kind === 'item')).toBe(true);
    expect(names(rows)).toEqual(['Sel', 'Riz', 'Beurre', 'Lait']);
  });

  it('keeps the search relevance order, includes empty items and ignores grouping', () => {
    const { rows, itemCount } = buildStockRows(items, view({ group: 'category', showEmpty: false }), labels, NOW, [
      '2',
      '9',
      '1',
    ]);
    expect(rows.every((r) => r.kind === 'item')).toBe(true);
    expect(names(rows)).toEqual(['Lait', 'Riz']);
    expect(itemCount).toBe(2);
  });

  it('marks the first and last row of each section', () => {
    const { rows } = buildStockRows(items, view({ group: 'quantity' }), labels, NOW);
    const itemRows = rows.filter((r) => r.kind === 'item');
    expect(itemRows.map((r) => (r.kind === 'item' ? `${r.first}${r.last}` : ''))).toEqual([
      'truetrue',
      'truetrue',
      'truefalse',
      'falsetrue',
    ]);
  });
});
