import { describe, expect, it } from 'vitest';
import type { Movement } from '@/domain/types';
import { labelKey, median, prefersMedian, pricePoints, priceStats, receiptLabelMemory } from './prices';

let n = 0;
function mv(over: Partial<Movement>): Movement {
  n += 1;
  return {
    id: `m${n}`,
    seq: n,
    householdId: 'h' as never,
    pantryId: 'pa' as never,
    productId: 'p1' as never,
    kind: 'restock',
    counted: null,
    requestedDelta: 1,
    appliedDelta: 1,
    quantityAfter: 1,
    transferId: null,
    revertsId: null,
    actorId: null,
    source: 'receipt',
    clientAt: null,
    createdAt: `2026-01-${String((n % 28) + 1).padStart(2, '0')}T10:00:00Z`,
    ...over,
  } as Movement;
}

const prices = (values: number[]) =>
  values.map((priceCents, i) => mv({ priceCents, createdAt: `2026-02-${String(i + 1).padStart(2, '0')}T10:00:00Z` }));

describe('median', () => {
  it('handles odd and even counts', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});

describe('pricePoints', () => {
  it('keeps priced restocks of the product, oldest first, without reverted ones', () => {
    const a = mv({ priceCents: 100, createdAt: '2026-03-02T00:00:00Z' });
    const b = mv({ priceCents: 120, createdAt: '2026-03-01T00:00:00Z' });
    const undone = mv({ priceCents: 999 });
    const correction = mv({ kind: 'correction', revertsId: undone.id as never, priceCents: null, requestedDelta: -1 });
    const unpriced = mv({});
    const other = mv({ productId: 'p2' as never, priceCents: 50 });
    const consume = mv({ kind: 'consume', requestedDelta: -1 });
    const points = pricePoints([a, b, undone, correction, unpriced, other, consume], 'p1');
    expect(points.map((p) => p.priceCents)).toEqual([120, 100]);
  });

  it('reads rows cached before the price fields existed as unpriced', () => {
    const legacy = mv({});
    delete (legacy as Partial<Movement>).priceCents;
    expect(pricePoints([legacy], 'p1')).toEqual([]);
  });
});

describe('priceStats', () => {
  it('returns null without purchases', () => {
    expect(priceStats([])).toBeNull();
  });

  it('shows the single price for one purchase', () => {
    const s = priceStats(pricePoints(prices([189]), 'p1'));
    expect(s).toMatchObject({ count: 1, measure: 'single', typicalCents: 189 });
  });

  it('uses the average when prices are regular', () => {
    const s = priceStats(pricePoints(prices([189, 195, 199, 192]), 'p1'));
    expect(s?.measure).toBe('mean');
    expect(s?.typicalCents).toBe(194);
    expect(s?.minCents).toBe(189);
    expect(s?.maxCents).toBe(199);
  });

  it('uses the median when a promotion skews the average', () => {
    const s = priceStats(pricePoints(prices([199, 199, 205, 99]), 'p1'));
    expect(s?.measure).toBe('median');
    expect(s?.typicalCents).toBe(199);
  });

  it('two purchases use the average', () => {
    expect(priceStats(pricePoints(prices([100, 200]), 'p1'))?.measure).toBe('mean');
  });

  it('the latest is the newest purchase', () => {
    const s = priceStats(pricePoints(prices([100, 110, 120]), 'p1'));
    expect(s?.latest.priceCents).toBe(120);
  });
});

describe('prefersMedian', () => {
  it('flags a lone outlier even when the average barely moves', () => {
    const regular = Array.from({ length: 30 }, () => 300);
    expect(prefersMedian([...regular, 301, 299, 600])).toBe(true);
  });
  it('ignores small spreads', () => {
    expect(prefersMedian([300, 305, 298, 310, 302])).toBe(false);
  });
});

describe('receiptLabelMemory', () => {
  it('maps a label to the most recently matched live product', () => {
    const old = mv({ receiptLabel: 'LAIT DEMI ECR 1L', productId: 'p1' as never, createdAt: '2026-01-01T00:00:00Z' });
    const recent = mv({
      receiptLabel: 'lait demi écr  1L',
      productId: 'p2' as never,
      createdAt: '2026-02-01T00:00:00Z',
    });
    const gone = mv({ receiptLabel: 'CAFE', productId: 'p3' as never });
    const memory = receiptLabelMemory([old, recent, gone], (id) => id !== 'p3');
    expect(memory.get(labelKey('LAIT DEMI ECR 1L'))).toBe('p2');
    expect(memory.has(labelKey('CAFE'))).toBe(false);
  });
});
