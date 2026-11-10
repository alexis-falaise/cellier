import { describe, expect, it } from 'vitest';
import type { GroceryEntry, GroceryId, PantryId, ProductId, UserId } from '@/domain/types';
import { nextTrip, shoppingCadence } from './cadence';
import { householdRestockTimes } from './ledger';
import { day, LedgerBuilder } from './ledgerBuilder.testing';
import { groceryList, isDismissalActive, runningLowView, shoppingList, suggestedQuantity } from './lists';
import { DAY_MS, HOUR_MS, parisDate, parisWeekday } from './time';
import type { Cadence, NextTrip, ProductForecast, RunOutBand } from './types';

const id = (s: string) => s as ProductId;
const NOW = day(100);

function forecast(productId: string, o: Partial<ProductForecast> = {}): ProductForecast {
  return {
    productId: id(productId),
    totalQuantity: 3,
    usualQuantity: 6,
    usualQuantitySource: 'computed',
    minimum: 2,
    clearLevel: 3,
    rate: { ratePerDay: 0.5, rawRate: 0.5, shape: 20, exposureDays: 30, weightedQuantity: 15, events: 10, asOf: NOW },
    daysLeft: null,
    runOut: null,
    confidence: 'medium',
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

const band = (medianDays: number): RunOutBand => ({
  median: NOW + medianDays * DAY_MS,
  earliest: NOW + medianDays * 0.7 * DAY_MS,
  latest: NOW + medianDays * 1.4 * DAY_MS,
});

const low = (productId: string, o: Partial<ProductForecast> = {}) =>
  forecast(productId, { runningLow: true, lowByThreshold: true, lowReason: 'threshold', ...o });

const names = new Map(['a', 'b', 'c', 'd', 'e', 'f'].map((k) => [id(k), `Produit ${k.toUpperCase()}`]));

const trip = (o: Partial<NextTrip> = {}): NextTrip => ({
  tripAt: NOW + 3 * DAY_MS,
  tripOn: null,
  cadence: null,
  gapDays: 7,
  pulledForward: false,
  ...o,
});

describe('shoppingCadence (§5.8, scenario 17)', () => {
  it('needs 3 sessions and merges restocks within 6 h', () => {
    expect(shoppingCadence([day(0), day(7)], day(10))).toBeNull();
    expect(shoppingCadence([day(0), day(0) + 3 * HOUR_MS, day(7)], day(10))).toBeNull();
  });

  it('finds a weekly cadence on the usual weekday', () => {
    const times: number[] = [];
    const jitter = [0, 1, -1, 0, 0, 1, -1, 0, 0, 0];
    for (let i = 0; i < 10; i++) {
      const t = day(i * 7 + (jitter[i] ?? 0)) + 6 * HOUR_MS;
      times.push(t, t + HOUR_MS); // two scans in the same trip
    }
    const now = day(66);
    const c = shoppingCadence(times, now);
    expect(c).not.toBeNull();
    if (!c) return;
    expect(c.sessions).toBe(10);
    expect(Math.abs(c.medianGapDays - 7)).toBeLessThanOrEqual(0.5);
    expect(c.usualWeekday).toBe(parisWeekday(day(0) + 6 * HOUR_MS));
    expect(c.confidence).toBe('high');
    expect(c.nextAt).toBe(Math.max(c.lastSessionAt + c.medianGapDays * DAY_MS, now + DAY_MS));
  });

  it('irregular gaps lower the confidence', () => {
    const times = [0, 2, 12, 14, 30, 31].map((d) => day(d));
    expect(shoppingCadence(times, day(32))?.confidence).toBe('medium');
    expect(shoppingCadence(times.slice(0, 3), day(32))?.confidence).toBe('low');
  });

  it('builds restock times from the household ledger', () => {
    const b = new LedgerBuilder();
    b.restock(day(0), 2);
    b.consume(day(1), 1);
    b.restock(day(2), 1, { pantry: 'gone' as PantryId });
    expect(householdRestockTimes(b.movements, new Set(['gone' as PantryId]))).toEqual([day(0)]);
  });
});

describe('nextTrip (§5.8, scenario 18)', () => {
  const cadence: Cadence = {
    medianGapDays: 7,
    usualWeekday: 6,
    usualWeekdayShare: 1,
    sessions: 8,
    confidence: 'high',
    lastSessionAt: NOW - 2 * DAY_MS,
    nextAt: NOW + 5 * DAY_MS,
  };

  it('uses the cadence date when nothing runs out first', () => {
    const t = nextTrip(cadence, [forecast('a', { runOut: band(20) })], NOW);
    expect(t.tripAt).toBe(NOW + 5 * DAY_MS);
    expect(t.tripOn).toBe(parisDate(NOW + 5 * DAY_MS));
    expect(t.pulledForward).toBe(false);
    expect(t.gapDays).toBe(7);
  });

  it('is pulled forward by the 3rd-soonest run-out, never before now', () => {
    const fs = [band(1), band(2), band(2.5), band(30)].map((b, i) => forecast(`p${i}`, { runOut: b }));
    const t = nextTrip(cadence, fs, NOW);
    expect(t.tripAt).toBe(NOW + 2.5 * DAY_MS);
    expect(t.pulledForward).toBe(true);
    const past = [band(-3), band(-2), band(-1)].map((b, i) => forecast(`q${i}`, { runOut: b }));
    expect(nextTrip(cadence, past, NOW).tripAt).toBe(NOW);
  });

  it('suggests no date without a cadence', () => {
    const t = nextTrip(null, [], NOW);
    expect(t.tripOn).toBeNull();
    expect(t.tripAt).toBe(NOW + 7 * DAY_MS);
    expect(t.gapDays).toBe(7);
  });
});

describe('dismissals (§5.12, scenario 20)', () => {
  it('hide until the next restock, server or pending', () => {
    const f = forecast('a', { lastRestockAt: day(90) });
    const d = { productId: id('a'), scope: 'home' as const, dismissedAt: day(95), restockAtDismissal: day(90) };
    expect(isDismissalActive(d, f)).toBe(true);
    expect(isDismissalActive(d, { ...f, lastRestockAt: day(96) })).toBe(false);
    expect(isDismissalActive({ ...d, restockAtDismissal: null }, { ...f, lastRestockAt: null })).toBe(true);
  });

  it('scopes are independent', () => {
    const fs = [low('a')];
    const home = [{ productId: id('a'), scope: 'home' as const, dismissedAt: NOW, restockAtDismissal: day(90) }];
    expect(runningLowView(fs, names, home)).toHaveLength(0);
    expect(shoppingList(fs, names, trip(), home, NOW).entries).toHaveLength(1);
  });
});

describe('runningLowView (§5.10)', () => {
  it('orders out first, then days left, then total, then name; excludes non-low', () => {
    const fs = [
      low('a', { totalQuantity: 2, daysLeft: 3, runOut: band(3), lowReason: 'forecast', lowByThreshold: false }),
      low('b', { totalQuantity: 0, daysLeft: 0, lowReason: 'out' }),
      low('c', { totalQuantity: 1 }), // threshold without forecast counts as 0 days
      low('d', { totalQuantity: 1 }),
      forecast('e'),
    ];
    const view = runningLowView(fs, names, []);
    expect(view.map((e) => e.productId)).toEqual(['b', 'c', 'd', 'a']);
    expect(view[0]?.reason).toBe('out');
  });
});

describe('shoppingList (§5.11, scenario 19)', () => {
  it('suggests running-low products and those running out before the trip after next', () => {
    const fs = [
      low('a', { totalQuantity: 1 }),
      forecast('b', { runOut: band(8) }), // before tripAt (3) + gap (7)
      forecast('c', { runOut: band(15) }), // after the horizon
      low('d', { lowAlert: false, runningLow: false }),
      low('e', { deleted: true, runningLow: false }),
    ];
    const list = shoppingList(fs, names, trip(), [], NOW);
    expect(list.entries.map((e) => [e.productId, e.reason])).toEqual([
      ['a', 'threshold'],
      ['b', 'before-next-trip'],
    ]);
    expect(list.entries[0]?.urgencyDays).toBeCloseTo(-3);
    expect(list.entries[1]?.urgencyDays).toBeCloseTo(5);
  });

  it('suggests usual − total, at least 1, the clear level when usual is unknown', () => {
    expect(suggestedQuantity({ usualQuantity: 6, clearLevel: 3, totalQuantity: 1 })).toBe(5);
    expect(suggestedQuantity({ usualQuantity: 6, clearLevel: 3, totalQuantity: 7 })).toBe(1);
    expect(suggestedQuantity({ usualQuantity: null, clearLevel: 2, totalQuantity: 0 })).toBe(2);
  });
});

describe('groceryList (Courses merged with entries)', () => {
  let n = 0;
  const entry = (o: Partial<GroceryEntry>): GroceryEntry => {
    n++;
    return {
      id: `g${n}` as GroceryId,
      householdId: 'h1' as GroceryEntry['householdId'],
      productId: null,
      label: null,
      quantity: null,
      addedBy: 'u1' as UserId,
      checkedAt: null,
      checkedBy: null,
      dismissedAt: null,
      createdAt: new Date(day(95) + n).toISOString(),
      updatedAt: new Date(day(95) + n).toISOString(),
      deletedAt: null,
      ...o,
    };
  };
  const iso = (t: number) => new Date(t).toISOString();

  it('merges open entries into suggestions, keeps manual rows last and checked rows in the cart', () => {
    const fs = [
      low('a', { totalQuantity: 1 }),
      low('b', { totalQuantity: 0, lowReason: 'out' }),
      forecast('c'),
      low('d'),
      low('e'),
    ];
    const entries = [
      entry({ productId: id('a'), quantity: 2 }), // merged into the suggestion of a
      entry({ productId: id('c') }), // manual row of a non-low product
      entry({ label: 'Bougies', quantity: 3 }),
      entry({ productId: id('d'), dismissedAt: iso(day(95)) }), // dismissed, no restock since
      entry({ productId: id('e'), checkedAt: iso(day(99)) }), // in the cart
      entry({ productId: id('f'), deletedAt: iso(day(96)) }),
    ];
    const list = groceryList({ forecasts: fs, names, entries, trip: trip(), now: NOW });
    expect(list.toBuy.map((i) => i.key)).toEqual(['suggested:b', 'g1', 'g2', 'g3']);
    const a = list.toBuy[1];
    expect(a?.kind === 'product' && [a.quantity, a.suggestedQuantity, a.reason]).toEqual([2, 5, 'threshold']);
    const c = list.toBuy[2];
    expect(c?.kind === 'product' && [c.quantity, c.reason, c.urgencyDays]).toEqual([3, 'manual', null]);
    const label = list.toBuy[3];
    expect(label?.kind === 'label' && label.label).toBe('Bougies');
    expect(list.inCart.map((i) => i.key)).toEqual(['g5']);
    expect(list.inCart[0]?.checked).toBe(true);
  });

  it('a restock after the dismissal or the check brings the suggestion back', () => {
    const fs = [low('d', { lastRestockAt: day(97) }), low('e', { lastRestockAt: day(99) + 1 })];
    const entries = [
      entry({ productId: id('d'), dismissedAt: iso(day(95)) }),
      entry({ productId: id('e'), checkedAt: iso(day(99)) }),
    ];
    const list = groceryList({ forecasts: fs, names, entries, trip: trip(), now: NOW });
    expect(list.toBuy.map((i) => i.key).sort()).toEqual(['suggested:d', 'suggested:e']);
    expect(list.inCart).toHaveLength(1);
  });

  it('applies device-local dismissals and skips unknown or deleted products', () => {
    const fs = [low('a'), low('b', { deleted: true })];
    const list = groceryList({
      forecasts: fs,
      names,
      entries: [entry({ productId: id('zz') }), entry({ productId: id('b') })],
      trip: trip(),
      now: NOW,
      dismissals: [{ productId: id('a'), scope: 'courses', dismissedAt: NOW, restockAtDismissal: day(90) }],
    });
    expect(list.toBuy).toEqual([]);
  });

  it('works for a household with no forecast history', () => {
    const list = groceryList({
      forecasts: [],
      names,
      entries: [entry({ productId: id('a') }), entry({ label: 'Sel' })],
      trip: trip(),
      now: NOW,
    });
    expect(list.toBuy.map((i) => (i.kind === 'product' ? [i.name, i.quantity] : [i.label, i.quantity]))).toEqual([
      ['Produit A', 1],
      ['Sel', null],
    ]);
  });
});
