import { describe, expect, it } from 'vitest';
import type { Category, GroceryId, ProductId, ProductView } from '@/domain/types';
import type { GroceryItem, GroceryList, NextTrip } from '@/features/forecast';
import { monthIndex } from '@/features/seasonal';
import { knownFoods, listedFoods, parisMonth } from './seasonal';

function view(id: string, over: { name: string; kind?: string | null; category?: string | null; qty?: number }) {
  return {
    product: { id: id as ProductId, name: over.name, kind: over.kind ?? null, deletedAt: null },
    category: over.category ? ({ templateKey: over.category } as unknown as Category) : null,
    totalQuantity: over.qty ?? 0,
    lastRestockAt: '2026-01-10T10:00:00Z',
  } as unknown as ProductView;
}

const product = (productId: string, name: string, checked = false): GroceryItem => ({
  kind: 'product',
  key: `suggested:${productId}`,
  productId: productId as ProductId,
  name,
  entryId: null,
  quantity: 1,
  suggestedQuantity: 1,
  reason: 'threshold',
  urgencyDays: 0,
  totalQuantity: 0,
  runOut: null,
  confidence: null,
  checked,
  addedBy: null,
});

const label = (text: string): GroceryItem => ({
  kind: 'label',
  key: `g-${text}`,
  entryId: `g-${text}` as GroceryId,
  label: text,
  quantity: null,
  checked: false,
  addedBy: null,
});

describe('seasonal adapters', () => {
  it('reads the Paris month', () => {
    // 31 Oct 2026 23:30 UTC is already 1 November in Paris.
    expect(parisMonth(Date.UTC(2026, 9, 31, 23, 30))).toBe(monthIndex(2026, 11));
  });

  it('maps list rows to foods: products by kind, free text by name', () => {
    const views = [
      view('a', { name: 'Avocat Hass x2', kind: 'avocat', category: 'fruits' }),
      view('b', { name: 'Sauce tomate', kind: 'sauce tomate', category: 'conserves' }),
    ];
    const list: GroceryList = {
      trip: {} as NextTrip,
      toBuy: [product('a', 'Avocat'), product('b', 'Sauce tomate'), label('Tomates')],
      inCart: [label('Courgettes')].map((i) => ({ ...i, checked: true })),
    };
    const foods = listedFoods(list, new Map(views.map((v) => [v.product.id as string, v])));
    expect(foods.map((f) => [f.name, f.slug, f.checked])).toEqual([
      ['Avocat', 'avocat', false],
      ['Sauce tomate', null, false],
      ['Tomates', 'tomate', false],
      ['Courgettes', 'courgette', true],
    ]);
  });

  it('keeps only household products that are seasonal foods', () => {
    const foods = knownFoods([
      view('a', { name: 'Clémentines de Corse', kind: 'clémentine', category: 'fruits', qty: 2 }),
      view('b', { name: 'Lessive', kind: 'lessive', category: 'entretien' }),
    ]);
    expect(foods).toEqual([
      { productId: 'a', slug: 'clementine', inStock: true, lastBoughtAt: Date.parse('2026-01-10T10:00:00Z') },
    ]);
  });
});
