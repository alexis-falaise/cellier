import { describe, expect, it } from 'vitest';
import { countItems, moveStockPlan, nextSortOrder, reorderPlan, validatePantryName } from './pantries';

describe('pantries', () => {
  const pantries = [
    { id: 'a', name: 'Cave', sortOrder: 10 },
    { id: 'b', name: 'Cuisine', sortOrder: 20 },
    { id: 'c', name: 'Garage', sortOrder: 30 },
  ];

  it('validates names (required, unique ignoring case and accents)', () => {
    expect(validatePantryName(' ', pantries, null)).toBe('required');
    expect(validatePantryName('CAVE', pantries, null)).toBe('taken');
    expect(validatePantryName('Cave', pantries, 'a')).toBeNull();
    expect(validatePantryName('Cellier', pantries, null)).toBeNull();
  });

  it('orders new celliers last', () => {
    expect(nextSortOrder(pantries)).toBe(40);
    expect(nextSortOrder([])).toBe(10);
  });

  it('moves one row into a gap, or renumbers when there is none', () => {
    expect(reorderPlan(pantries, 2, 0)).toEqual([{ id: 'c', sortOrder: 0 }]);
    expect(reorderPlan(pantries, 0, 2)).toEqual([{ id: 'a', sortOrder: 40 }]);
    expect(reorderPlan(pantries, 0, 1)).toEqual([{ id: 'a', sortOrder: 25 }]);
    const tight = [
      { id: 'a', sortOrder: 1 },
      { id: 'b', sortOrder: 2 },
      { id: 'c', sortOrder: 3 },
    ];
    expect(reorderPlan(tight, 0, 1)).toEqual([
      { id: 'b', sortOrder: 10 },
      { id: 'a', sortOrder: 20 },
      { id: 'c', sortOrder: 30 },
    ]);
    expect(reorderPlan(pantries, 1, 1)).toEqual([]);
  });

  it('counts products in stock per cellier and overall', () => {
    const stock = [
      { pantryId: 'a', productId: 'x', quantity: 2 },
      { pantryId: 'b', productId: 'x', quantity: 1 },
      { pantryId: 'b', productId: 'y', quantity: 0 },
      { pantryId: 'b', productId: 'z', quantity: 3 },
      { pantryId: 'gone', productId: 'w', quantity: 3 },
      { pantryId: 'a', productId: 'deleted', quantity: 3 },
    ];
    const counts = countItems(stock, new Set(['x', 'y', 'z', 'w']), new Set(['a', 'b']));
    expect(counts.byPantry.get('a')).toBe(1);
    expect(counts.byPantry.get('b')).toBe(2);
    expect(counts.all).toBe(2);
  });

  it('plans one transfer per product left in a deleted cellier', () => {
    const plan = moveStockPlan('a', 'b', [
      { productId: 'x', quantity: 2 },
      { productId: 'y', quantity: 0 },
    ]);
    expect(plan).toEqual([{ fromPantryId: 'a', toPantryId: 'b', productId: 'x', quantity: 2, source: 'form' }]);
    expect(moveStockPlan('a', 'a', [{ productId: 'x', quantity: 2 }])).toEqual([]);
  });
});
