import { describe, expect, it } from 'vitest';
import type { ProductForecast } from '@/features/forecast';
import { lowBadgeText, nextToWatch, runningLowCount, runningLowRows } from './runningLow';

const NOW = Date.UTC(2026, 10, 10, 12);
const plain = (text: string) => text.replace(/[\u00a0\u202f]/g, ' ');

function f(over: Omit<Partial<ProductForecast>, 'productId'> & { productId: string }): ProductForecast {
  return {
    totalQuantity: 1,
    usualQuantity: null,
    usualQuantitySource: null,
    minimum: 1,
    clearLevel: 2,
    rate: { ratePerDay: 0, rawRate: 0, shape: 1, exposureDays: 0, weightedQuantity: 0, events: 0, asOf: NOW },
    daysLeft: null,
    runOut: null,
    confidence: 'low',
    lowByThreshold: true,
    lowByForecast: false,
    runningLow: true,
    lowReason: 'threshold',
    lastRestockAt: null,
    lastSeq: null,
    lowAlert: true,
    deleted: false,
    ...over,
  } as unknown as ProductForecast;
}

const band = { median: NOW, earliest: NOW, latest: NOW };
const names = new Map([
  ['eau', 'Eau'],
  ['beurre', 'Beurre'],
  ['cafe', 'Café'],
  ['lait', 'Lait'],
  ['riz', 'Riz'],
  ['sel', 'Sel'],
  ['the', 'Thé'],
]);

describe('runningLowRows', () => {
  const forecasts = [
    f({ productId: 'riz', totalQuantity: 2, minimum: 2 }),
    f({ productId: 'cafe', totalQuantity: 1, daysLeft: 3, runOut: band, confidence: 'medium' }),
    f({ productId: 'eau', totalQuantity: 0, lowReason: 'out' }),
    f({ productId: 'lait', totalQuantity: 1, daysLeft: 1.5, runOut: band, confidence: 'high' }),
    f({ productId: 'beurre', totalQuantity: 0, lowReason: 'out' }),
    f({ productId: 'sel', totalQuantity: 1, minimum: 3 }),
    f({ productId: 'the', runningLow: false, lowReason: null }),
  ];

  it('orders out of stock by name, then forecasts by cover, then seuil by ratio', () => {
    expect(runningLowRows(forecasts, names).map((r) => r.name)).toEqual([
      'Beurre',
      'Eau',
      'Lait',
      'Café',
      'Sel',
      'Riz',
    ]);
  });

  it('treats a low-confidence forecast as seuil only', () => {
    const rows = runningLowRows(
      [f({ productId: 'cafe', daysLeft: 2, runOut: band, confidence: 'low' }), f({ productId: 'lait' })],
      names,
    );
    expect(rows.map((r) => [r.name, r.badge.kind])).toEqual([
      ['Café', 'threshold'],
      ['Lait', 'threshold'],
    ]);
  });

  it('narrows to one cellier', () => {
    expect(runningLowRows(forecasts, names, (id) => id === 'riz').map((r) => r.name)).toEqual(['Riz']);
  });

  it('counts running-low products for the app badge', () => {
    expect(runningLowCount(forecasts)).toBe(6);
  });
});

describe('badges', () => {
  it('follows the honesty rules', () => {
    expect(lowBadgeText({ kind: 'out' }).label).toBe('Épuisé');
    expect(plain(lowBadgeText({ kind: 'cover', days: 0.4 }).label)).toBe('< 1 j');
    expect(plain(lowBadgeText({ kind: 'cover', days: 3.6 }).label)).toBe('≈ 4 j');
    expect(lowBadgeText({ kind: 'cover', days: 3.6 }).accessibleLabel).toBe('Environ 4 jours de stock');
    expect(lowBadgeText({ kind: 'threshold' }).label).toBe('Seuil');
  });
});

describe('nextToWatch', () => {
  it('picks the smallest usable cover among products not low', () => {
    const forecasts = [
      f({ productId: 'cafe', runningLow: false, totalQuantity: 4, daysLeft: 9.2, runOut: band, confidence: 'high' }),
      f({ productId: 'lait', runningLow: false, totalQuantity: 4, daysLeft: 6.6, runOut: band, confidence: 'medium' }),
      f({ productId: 'riz', runningLow: false, totalQuantity: 4, daysLeft: 2, runOut: band, confidence: 'low' }),
    ];
    expect(nextToWatch(forecasts, names)).toEqual({ name: 'Lait', days: 7 });
    expect(nextToWatch([], names)).toBeNull();
  });
});
