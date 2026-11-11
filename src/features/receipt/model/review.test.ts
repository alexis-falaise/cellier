import { describe, expect, it } from 'vitest';
import type { PantryId, ProductId } from '@/domain/types';
import { labelKey } from '@/features/prices';
import {
  buildReview,
  defaultPantryFor,
  isWritable,
  needsProduct,
  planReceipt,
  type ReceiptDto,
  type ReviewContext,
  writableUnits,
} from './review';

const P = (s: string) => s as ProductId;
const K = (s: string) => s as PantryId;

const ctx = (over: Partial<ReviewContext> = {}): ReviewContext => ({
  isLiveProduct: (id) => ['milk', 'coffee', 'rice'].includes(id),
  memory: new Map(),
  pantryIds: [K('kitchen'), K('cellar')],
  stock: [],
  restocks: [],
  fallbackPantryId: K('kitchen'),
  ...over,
});

const line = (over: Partial<ReceiptDto['lines'][number]> = {}) => ({
  label: 'LAIT DEMI ECR',
  name: 'Lait demi-écrémé',
  quantity: 2,
  unitPriceCents: 99,
  totalCents: 198,
  productId: null,
  skip: false,
  ...over,
});

describe('defaultPantryFor', () => {
  it('prefers the cellier holding the most', () => {
    const c = ctx({
      stock: [
        { pantryId: K('kitchen'), productId: P('milk'), quantity: 1 },
        { pantryId: K('cellar'), productId: P('milk'), quantity: 6 },
      ],
    });
    expect(defaultPantryFor(P('milk'), c)).toBe('cellar');
  });

  it('falls back to the last restock, then the fallback, ignoring deleted celliers', () => {
    const c = ctx({
      restocks: [
        { pantryId: K('gone'), productId: P('milk') },
        { pantryId: K('cellar'), productId: P('milk') },
      ],
    });
    expect(defaultPantryFor(P('milk'), c)).toBe('cellar');
    expect(defaultPantryFor(P('rice'), c)).toBe('kitchen');
    expect(defaultPantryFor(null, ctx({ fallbackPantryId: null }))).toBe('kitchen');
  });
});

describe('buildReview', () => {
  it('a remembered label wins over the model; unknown model ids are dropped', () => {
    const memory = new Map([[labelKey('CAFE MOULU'), P('coffee')]]);
    const lines = buildReview(
      {
        store: null,
        purchasedOn: null,
        totalCents: null,
        lines: [
          line({ label: 'CAFE MOULU', productId: 'rice' }),
          line({ productId: 'milk' }),
          line({ label: 'X', productId: 'ghost' }),
          line({ label: 'SAC', skip: true }),
        ],
      },
      ctx({ memory }),
    );
    expect(lines.map((l) => [l.productId, l.match])).toEqual([
      ['coffee', 'memory'],
      ['milk', 'model'],
      [null, null],
      [null, null],
    ]);
    expect(lines.map(needsProduct)).toEqual([false, false, true, false]);
    expect(lines.map(isWritable)).toEqual([true, true, false, false]);
    expect(writableUnits(lines)).toBe(4);
  });

  it('clamps quantities', () => {
    const [l] = buildReview(
      { store: null, purchasedOn: null, totalCents: null, lines: [line({ quantity: 0 })] },
      ctx(),
    );
    expect(l?.quantity).toBe(1);
  });
});

describe('planReceipt', () => {
  const lines = buildReview(
    {
      store: 'Carrefour',
      purchasedOn: null,
      totalCents: null,
      lines: [
        line({ productId: 'milk', unitPriceCents: 99 }),
        line({ productId: 'milk', unitPriceCents: 89, quantity: 1 }),
        line({ label: 'RIZ', productId: 'rice', unitPriceCents: null }),
        line({ label: 'SAC', productId: 'coffee', skip: true }),
      ],
    },
    ctx(),
  );

  it('writes restocks, then prices (last line wins), then closes Courses entries', () => {
    const plan = planReceipt(lines, {
      receiptId: 'r1',
      store: ' Carrefour ',
      product: (id) => ({ id, priceCents: id === 'rice' ? 150 : 120, priceSource: 'catalog' }),
      openGroceryEntry: (id) => (id === 'milk' ? { id: 'g1' as never } : undefined),
    });
    expect(plan.map((m) => m.name)).toEqual([
      'stock.add',
      'stock.add',
      'stock.add',
      'product.update',
      'grocery.delete',
    ]);
    expect(plan[0]).toMatchObject({
      args: {
        productId: 'milk',
        pantryId: 'kitchen',
        quantity: 2,
        source: 'receipt',
        priceCents: 99,
        receiptId: 'r1',
        store: 'Carrefour',
        receiptLabel: 'LAIT DEMI ECR',
      },
    });
    expect(plan[3]).toEqual({
      name: 'product.update',
      args: { productId: 'milk', fields: { priceCents: 89, priceSource: 'receipt' } },
    });
  });

  it('skips an unchanged receipt price', () => {
    const plan = planReceipt(lines.slice(1, 2), {
      receiptId: 'r1',
      store: null,
      product: (id) => ({ id, priceCents: 89, priceSource: 'receipt' }),
      openGroceryEntry: () => undefined,
    });
    expect(plan.map((m) => m.name)).toEqual(['stock.add']);
  });
});
