import { describe, expect, it } from 'vitest';
import type { ProductId } from '@/domain/types';
import { type KindProduct, mergeKindForecasts } from './kinds';
import { day } from './ledgerBuilder.testing';
import { shoppingList } from './lists';
import type { NextTrip, ProductForecast } from './types';

const id = (s: string) => s as ProductId;
const NOW = day(100);

function forecast(productId: string, o: Partial<ProductForecast> = {}): ProductForecast {
  return {
    productId: id(productId),
    totalQuantity: 1,
    usualQuantity: 1,
    usualQuantitySource: 'computed',
    minimum: 1,
    clearLevel: 2,
    rate: { ratePerDay: 0, rawRate: 0, shape: 1, exposureDays: 0, weightedQuantity: 0, events: 0, asOf: NOW },
    daysLeft: null,
    runOut: null,
    confidence: 'low',
    lowByThreshold: false,
    lowByForecast: false,
    runningLow: false,
    lowReason: null,
    lastRestockAt: day(90),
    lastSeq: 1,
    lowAlert: true,
    deleted: false,
    ...o,
  };
}

const empty = (productId: string, o: Partial<ProductForecast> = {}) =>
  forecast(productId, {
    totalQuantity: 0,
    runningLow: true,
    lowByThreshold: true,
    lowReason: 'out',
    daysLeft: 0,
    ...o,
  });

function products(list: Array<Omit<Partial<KindProduct>, 'id'> & { id: string }>): Map<string, KindProduct> {
  return new Map(
    list.map((p) => [
      p.id,
      {
        kind: null,
        minQuantity: null,
        suggestedMin: null,
        lowAlert: true,
        deletedAt: null,
        ...p,
        id: id(p.id),
      } as KindProduct,
    ]),
  );
}

const trip: NextTrip = { tripAt: NOW + 3 * 86_400_000, tripOn: null, cadence: null, gapDays: 7, pulledForward: false };
const coffees = products([
  { id: 'eth', kind: 'café moulu' },
  { id: 'col', kind: 'Café moulu' },
  { id: 'bre', kind: 'café moulu' },
  { id: 'gua', kind: 'café moulu' },
]);

describe('mergeKindForecasts', () => {
  it('does not ask for coffee when one of four ground coffees runs out', () => {
    const own = [empty('eth'), forecast('col'), forecast('bre'), forecast('gua')];
    const { forecasts, groups } = mergeKindForecasts(own, coffees, NOW);
    expect(forecasts.filter((f) => f.runningLow)).toEqual([]);
    expect(shoppingList(forecasts, new Map(), trip, [], NOW).entries).toEqual([]);
    expect(groups.get(id('eth'))?.members).toHaveLength(4);
  });

  it('flags the kind once, on the most recently restocked product, when the total reaches the seuil', () => {
    const own = [
      empty('eth'),
      empty('col', { lastRestockAt: day(95) }),
      empty('bre'),
      forecast('gua', { lowByThreshold: true, runningLow: true, lowReason: 'threshold' }),
    ];
    const { forecasts } = mergeKindForecasts(own, coffees, NOW);
    const low = forecasts.filter((f) => f.runningLow);
    expect(low.map((f) => [f.productId, f.totalQuantity])).toEqual([['col', 1]]);
  });

  it('uses the largest seuil a member set, else the suggested one', () => {
    const own = [forecast('a', { totalQuantity: 2 }), forecast('b', { totalQuantity: 2 })];
    const set = products([
      { id: 'a', kind: 'eau plate', suggestedMin: 6 },
      { id: 'b', kind: 'eau plate', minQuantity: 3 },
    ]);
    expect(mergeKindForecasts(own, set, NOW).forecasts.find((f) => f.productId === 'a')?.minimum).toBe(3);
    const suggested = products([
      { id: 'a', kind: 'eau plate', suggestedMin: 6 },
      { id: 'b', kind: 'eau plate' },
    ]);
    const merged = mergeKindForecasts(own, suggested, NOW).forecasts.find((f) => f.minimum === 6);
    expect(merged?.runningLow).toBe(true);
  });

  it('a kind whose seuil is 0 has no alert threshold: never low, never on the courses list', () => {
    const own = [
      empty('a', { minimum: 0, runningLow: false, lowByThreshold: false, lowReason: null, lowAlert: false }),
      empty('b', { lastRestockAt: day(95) }),
    ];
    const set = products([
      { id: 'a', kind: 'barre de céréales', minQuantity: 0, suggestedMin: 1 },
      { id: 'b', kind: 'barre de céréales', suggestedMin: 1 },
    ]);
    const { forecasts } = mergeKindForecasts(own, set, NOW);
    expect(forecasts.map((f) => [f.minimum, f.runningLow, f.lowAlert])).toEqual([
      [0, false, false],
      [0, false, false],
    ]);
    expect(shoppingList(forecasts, new Map(), trip, [], NOW).entries).toEqual([]);
  });

  it('leaves products without a kind, or alone in their kind, untouched', () => {
    const own = [empty('x'), empty('y')];
    const { forecasts, groups } = mergeKindForecasts(own, products([{ id: 'x' }, { id: 'y', kind: 'riz' }]), NOW);
    expect(forecasts).toEqual(own);
    expect(groups.size).toBe(0);
  });
});
