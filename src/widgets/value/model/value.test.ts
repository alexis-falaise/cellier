import { describe, expect, it } from 'vitest';
import type { Category, PantryId, ProductView } from '@/domain/types';
import { product } from '@/features/forecast/model/ledgerBuilder.testing';
import { stockValue } from './value';

const cat = (id: string, name: string) => ({ id, name, deletedAt: null }) as unknown as Category;
const cafe = cat('c1', 'Café & thé');
const eau = cat('c2', 'Eaux');
const view = (
  id: string,
  price: number | null,
  category: Category | null,
  perPantry: Array<[string, number]>,
): ProductView =>
  ({
    product: product({ id: id as never, priceCents: price }),
    category,
    totalQuantity: perPantry.reduce((n, [, q]) => n + q, 0),
    perPantry: perPantry.map(([pantryId, quantity]) => ({ pantryId: pantryId as PantryId, quantity })),
    lastRestockAt: null,
    pending: false,
  }) as ProductView;

const views = [
  view('a', 450, cafe, [
    ['p1', 2],
    ['p2', 1],
  ]),
  view('b', 60, eau, [['p1', 6]]),
  view('c', null, eau, [['p1', 3]]),
  view('d', 999, cafe, [['p1', 0]]),
];

describe('stockValue', () => {
  it('sums quantity × price per category, largest first, and counts unpriced items apart', () => {
    const v = stockValue(views, null);
    expect(v.totalCents).toBe(1350 + 360);
    expect([v.priced, v.unpriced]).toEqual([2, 1]);
    expect(v.byCategory.map((c) => [c.category?.name, c.cents])).toEqual([
      ['Café & thé', 1350],
      ['Eaux', 360],
    ]);
    expect(v.byCategory[0]?.share).toBeCloseTo(1350 / 1710);
  });

  it('narrows to one pantry', () => {
    const v = stockValue(views, 'p2');
    expect([v.totalCents, v.priced, v.unpriced]).toEqual([450, 1, 0]);
  });
});
