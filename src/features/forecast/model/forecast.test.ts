import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CategoryKey, PantryId, Product } from '@/domain/types';
import { CATEGORY_PRIORS, DEFAULT_FORECAST_CONFIG } from './config';
import { demandEvents, reconstructTotals } from './ledger';
import { day, LedgerBuilder, P1, P2, PRODUCT, product, T0 } from './ledgerBuilder.testing';
import { forecastProduct, referenceTime } from './product';
import { consumptionRate, daysOfCover, runOutBand } from './rate';
import { clearLevel, effectiveMinimum, replayThresholdState, usualQuantity } from './threshold';
import { DAY_MS, HOUR_MS, parisDate, startOfParisDay } from './time';

const NONE = new Set<PantryId>();

function run(
  b: LedgerBuilder,
  now: number,
  opts: { category?: CategoryKey | null; product?: Partial<Product>; cadence?: boolean; deleted?: Set<PantryId> } = {},
) {
  return forecastProduct(
    {
      product: product(opts.product),
      categoryKey: opts.category ?? null,
      totalQuantity: b.total(),
      movements: b.movements,
      deletedPantryIds: opts.deleted ?? NONE,
      householdHasCadence: opts.cadence ?? false,
    },
    now,
  );
}

describe('Paris calendar helpers', () => {
  it('finds the start of the Paris day in winter and summer', () => {
    expect(new Date(startOfParisDay(Date.UTC(2026, 0, 5, 10))).toISOString()).toBe('2026-01-04T23:00:00.000Z');
    expect(new Date(startOfParisDay(Date.UTC(2026, 6, 1, 23, 30))).toISOString()).toBe('2026-07-01T22:00:00.000Z');
    // Daylight-saving days: 29 March and 25 October 2026.
    expect(new Date(startOfParisDay(Date.UTC(2026, 2, 29, 12))).toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(new Date(startOfParisDay(Date.UTC(2026, 9, 25, 12))).toISOString()).toBe('2026-10-24T22:00:00.000Z');
    expect(parisDate(Date.UTC(2026, 0, 4, 23, 30))).toBe('2026-01-05');
  });
});

describe('reconstructTotals (§5.2)', () => {
  it('sums pantries and counts a transfer between live pantries as no change (scenario 8)', () => {
    const b = new LedgerBuilder();
    b.restock(day(0), 3, { pantry: P1 });
    b.restock(day(0) + HOUR_MS, 2, { pantry: P2 });
    b.transfer(day(1), P1, P2, 2);
    b.consume(day(2), 1, { pantry: P2 });
    const s = reconstructTotals(PRODUCT, b.movements, NONE);
    expect(s.initialTotal).toBe(0);
    expect(s.points.map((p) => p.total)).toEqual([3, 5, 3, 5, 4]);
    expect(s.points.at(-1)?.total).toBe(b.total());
  });

  it('rebuilds the initial total of a truncated ledger (scenario 9)', () => {
    const full = new LedgerBuilder();
    full.restock(day(0), 6);
    full.consume(day(1), 1);
    full.consume(day(2), 1);
    const truncated = full.movements.slice(1);
    const s = reconstructTotals(PRODUCT, truncated, NONE);
    expect(s.initialTotal).toBe(6);
    expect(s.points.map((p) => p.total)).toEqual([5, 4]);
  });

  it('ignores deleted pantries (scenario 10)', () => {
    const b = new LedgerBuilder();
    b.restock(day(0), 4, { pantry: P1 });
    b.restock(day(0), 9, { pantry: P2 });
    b.consume(day(1), 1, { pantry: P2 });
    const s = reconstructTotals(PRODUCT, b.movements, new Set([P2]));
    expect(s.points.map((p) => p.total)).toEqual([4]);
  });

  it('trusts device time for at most 7 days and keeps the series ordered (scenario 11)', () => {
    const b = new LedgerBuilder();
    b.restock(day(0), 10);
    b.consume(day(20), 1, { clientAt: day(17) });
    b.consume(day(21), 1, { clientAt: day(11) });
    const s = reconstructTotals(PRODUCT, b.movements, NONE);
    expect(s.points.map((p) => p.at)).toEqual([day(0), day(17), day(17)]);
    const raw = b.movements[2];
    expect(raw && Date.parse(raw.createdAt) - 7 * DAY_MS).toBe(day(14));
  });

  it('orders pending movements after server ones, in the order given', () => {
    const b = new LedgerBuilder();
    b.restock(day(0), 5);
    b.consume(day(2), 1, { pending: true });
    b.consume(day(1), 1);
    const shuffled = [b.movements[1], b.movements[2], b.movements[0]].filter((m) => m !== undefined);
    const s = reconstructTotals(PRODUCT, shuffled, NONE);
    expect(s.points.map((p) => p.movementId)).toEqual(['m1', 'm3', 'm2']);
  });
});

describe('demandEvents (§5.3)', () => {
  it('counts only unreverted consumes (scenarios 6 and 7)', () => {
    const b = new LedgerBuilder();
    b.restock(day(0), 10);
    b.consume(day(1), 2);
    const wrong = b.consume(day(2), 3);
    b.revert(day(2) + HOUR_MS, wrong);
    b.discard(day(3), 1);
    b.recount(day(4), 2);
    b.transfer(day(5), P1, P2, 1);
    const s = reconstructTotals(PRODUCT, b.movements, NONE);
    expect(demandEvents(s, b.movements)).toEqual([{ at: day(1), quantity: 2 }]);
  });
});

describe('consumptionRate (§5.4)', () => {
  const prior = CATEGORY_PRIORS.autre;

  it('caps a bulk withdrawal at the usual quantity (scenario 5, bursts)', () => {
    const b = new LedgerBuilder();
    b.restock(day(0), 30);
    b.consume(day(10), 24);
    const s = reconstructTotals(PRODUCT, b.movements, NONE);
    const events = demandEvents(s, b.movements);
    const asOf = day(10);
    const capped = consumptionRate(s, events, asOf, prior, 6);
    const uncapped = consumptionRate(s, events, asOf, prior, Number.POSITIVE_INFINITY);
    expect(capped.weightedQuantity).toBeCloseTo(6);
    expect(uncapped.weightedQuantity).toBeCloseTo(24);
  });

  it('non-demand kinds do not change Q; a transfer leaves the exposure unchanged (scenario 6)', () => {
    const base = new LedgerBuilder();
    base.restock(day(0), 10);
    base.consume(day(5), 1);
    const withMoves = new LedgerBuilder();
    withMoves.restock(day(0), 10);
    withMoves.consume(day(5), 1);
    withMoves.transfer(day(6), P1, P2, 3);
    const asOf = day(20);
    const r = (b: LedgerBuilder) => {
      const s = reconstructTotals(PRODUCT, b.movements, NONE);
      return consumptionRate(s, demandEvents(s, b.movements), asOf, prior, Number.POSITIVE_INFINITY);
    };
    expect(r(withMoves).weightedQuantity).toBeCloseTo(r(base).weightedQuantity);
    expect(r(withMoves).exposureDays).toBeCloseTo(r(base).exposureDays);
  });

  it('excludes time out of stock from the exposure (zero stock)', () => {
    const b = new LedgerBuilder();
    b.restock(day(0), 2);
    b.consume(day(5), 2);
    const s = reconstructTotals(PRODUCT, b.movements, NONE);
    const r = consumptionRate(s, demandEvents(s, b.movements), day(30), prior, Number.POSITIVE_INFINITY);
    const lambda = Math.LN2 / 30;
    const w = (t: number) => Math.exp((-lambda * (day(30) - t)) / DAY_MS);
    expect(r.exposureDays).toBeCloseTo((w(day(5)) - w(day(0))) / lambda);
  });

  it('starts at the category prior for a new product (scenario 1)', () => {
    const s = reconstructTotals(PRODUCT, [], NONE);
    const r = consumptionRate(s, [], T0, CATEGORY_PRIORS.laitier, Number.POSITIVE_INFINITY);
    expect(r.ratePerDay).toBeCloseTo(0.35);
    expect(r.rawRate).toBe(0);
    expect(r.events).toBe(0);
  });

  it('cover and band', () => {
    expect(daysOfCover(0, 1)).toBe(0);
    expect(daysOfCover(3, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(daysOfCover(3, 0.5)).toBe(6);
    const rate = {
      ratePerDay: 0.5,
      rawRate: 0.5,
      shape: 16,
      exposureDays: 30,
      weightedQuantity: 14,
      events: 10,
      asOf: T0,
    };
    const band = runOutBand(3, rate);
    expect(band?.median).toBe(T0 + 6 * DAY_MS);
    expect(band && band.earliest < band.median && band.median < band.latest).toBe(true);
    expect(runOutBand(0, rate)).toBeNull();
    expect(runOutBand(3, { ...rate, ratePerDay: 0 })).toBeNull();
  });
});

describe('threshold rule (§5.6)', () => {
  it('derives m and c', () => {
    expect(effectiveMinimum(null, null)).toBe(1);
    expect(effectiveMinimum(null, 6)).toBe(2);
    expect(effectiveMinimum(0, 6)).toBe(0);
    expect(clearLevel(2, 6)).toBe(3);
    expect(clearLevel(1, null)).toBe(2);
    expect(clearLevel(2, 12)).toBe(6);
  });

  it('applies the hysteresis table (scenario 12)', () => {
    const b = new LedgerBuilder();
    b.restock(day(0), 6);
    const states: boolean[] = [];
    const step = (fn: () => void) => {
      fn();
      states.push(replayThresholdState(reconstructTotals(PRODUCT, b.movements, NONE), 2, 3, true, false));
    };
    for (let i = 1; i <= 5; i++) step(() => b.consume(day(i), 1)); // 5,4,3,2,1
    step(() => b.restock(day(6), 1)); // 2
    step(() => b.restock(day(7), 1)); // 3
    expect(states).toEqual([false, false, false, true, true, true, false]);
  });

  it('never low with lowAlert off, low only at 0 with minQuantity 0, never when deleted (scenario 13)', () => {
    const b = new LedgerBuilder();
    b.restock(day(0), 2);
    b.consume(day(1), 1);
    expect(run(b, day(2), { product: { lowAlert: false } }).runningLow).toBe(false);
    expect(run(b, day(2), { product: { minQuantity: 0 } }).runningLow).toBe(false);
    expect(run(b, day(2), { product: { deletedAt: new Date(day(2)).toISOString() } }).runningLow).toBe(false);
    b.consume(day(2), 1);
    const out = run(b, day(3), { product: { minQuantity: 0 } });
    expect(out.runningLow).toBe(true);
    expect(out.lowReason).toBe('out');
  });

  it('a restock to the clear level resets the state (restock resets)', () => {
    const b = new LedgerBuilder();
    b.restock(day(0), 6);
    b.consume(day(1), 5);
    expect(run(b, day(1) + HOUR_MS).lowByThreshold).toBe(true);
    b.restock(day(2), 5);
    expect(run(b, day(2) + HOUR_MS).lowByThreshold).toBe(false);
  });
});

describe('usualQuantity (§5.5, scenario 16)', () => {
  it('is the median post-restock level of the last 5 sessions, merging restocks within 6 h', () => {
    const b = new LedgerBuilder();
    const levels = [4, 8, 6, 6, 7, 5];
    levels.forEach((target, i) => {
      const t = day(i * 7);
      const half = Math.floor((target - b.total()) / 2);
      b.restock(t, half);
      b.restock(t + 2 * HOUR_MS, target - b.total()); // same session
      b.consume(t + DAY_MS, 3);
    });
    const s = reconstructTotals(PRODUCT, b.movements, NONE);
    expect(usualQuantity(s, day(40))).toBe(6); // median of 8, 6, 6, 7, 5
  });

  it('falls back to the maximum total, and is null without stock', () => {
    const b = new LedgerBuilder(PRODUCT, [[P1, 4]]);
    b.consume(day(1), 1);
    expect(usualQuantity(reconstructTotals(PRODUCT, b.movements, NONE), day(2))).toBe(3);
    expect(usualQuantity(reconstructTotals(PRODUCT, [], NONE), day(2))).toBeNull();
  });

  it('a user-set usual quantity overrides the computed one', () => {
    const b = new LedgerBuilder();
    b.restock(day(0), 6);
    b.consume(day(1), 4);
    const computed = run(b, day(2));
    expect(computed.usualQuantity).toBe(6);
    expect(computed.usualQuantitySource).toBe('computed');
    expect(computed.minimum).toBe(2);
    const user = run(b, day(2), { product: { usualQuantity: 12 } });
    expect(user.usualQuantity).toBe(12);
    expect(user.usualQuantitySource).toBe('user');
    expect(user.minimum).toBe(3);
    expect(user.runningLow).toBe(true);
  });
});

describe('forecastProduct (§5.7)', () => {
  it('new product, never stocked (scenario 1)', () => {
    const f = run(new LedgerBuilder(), T0, { category: 'laitier' });
    expect(f.rate.ratePerDay).toBeCloseTo(CATEGORY_PRIORS.laitier.ratePerDay);
    expect(f.confidence).toBe('low');
    expect(f.daysLeft).toBeNull();
    expect(f.runOut).toBeNull();
    expect(f.runningLow).toBe(false);
  });

  it('sparse history: stocked but fewer than 3 withdrawals gives no forecast', () => {
    const b = new LedgerBuilder();
    b.restock(day(0), 6);
    b.consume(day(3), 1);
    b.consume(day(9), 1);
    const f = run(b, day(10));
    expect(f.rate.events).toBe(2);
    expect(f.confidence).toBe('low');
    expect(f.daysLeft).toBeNull();
    expect(f.lowByForecast).toBe(false);
  });

  it('steady use converges to the true rate with high confidence (scenario 2)', () => {
    const b = new LedgerBuilder();
    for (let d = 0; d < 120; d++) {
      if (d % 7 === 0) b.restock(day(d), 6 - b.total());
      if (d % 2 === 1) b.consume(day(d) + 8 * HOUR_MS, 1);
    }
    const f = run(b, day(120), { category: 'laitier', cadence: true });
    expect(f.rate.ratePerDay).toBeGreaterThan(0.5 * 0.85);
    expect(f.rate.ratePerDay).toBeLessThan(0.5 * 1.15);
    expect(f.confidence).toBe('high');
    expect(f.daysLeft).not.toBeNull();
  });

  it('measures the in-stock rate when the product is often out of stock (scenario 3)', () => {
    const b = new LedgerBuilder();
    for (let d = 0; d < 120; d++) {
      if (d % 16 === 0) b.restock(day(d), 4);
      if (d % 16 < 8 && d % 2 === 1) b.consume(day(d), 1);
    }
    const f = run(b, day(120) + HOUR_MS, { category: 'laitier' });
    expect(f.rate.ratePerDay).toBeGreaterThan(0.5 * 0.8);
    expect(f.rate.ratePerDay).toBeLessThan(0.5 * 1.2);
    const naive30 = 7 / 30; // what a 30-day moving average would say
    expect(Math.abs(f.rate.ratePerDay - 0.5)).toBeLessThan(Math.abs(naive30 - 0.5));
  });

  it('decays when the product is abandoned (scenario 4)', () => {
    const b = new LedgerBuilder();
    b.restock(day(0), 100);
    for (let d = 1; d <= 30; d++) b.consume(day(d), 1);
    const at30 = run(b, day(30) + HOUR_MS).rate.ratePerDay;
    const at90 = run(b, day(90)).rate.ratePerDay;
    expect(at90).toBeLessThan(0.25 * at30);
  });

  it('forecast rule needs 3 withdrawals (scenario 14)', () => {
    const three = new LedgerBuilder();
    three.restock(day(0), 10);
    three.consume(day(1), 2);
    three.consume(day(2), 3);
    three.consume(day(3), 3);
    const f3 = run(three, day(3) + HOUR_MS, { category: 'eau', product: { minQuantity: 0 } });
    expect(f3.daysLeft).not.toBeNull();
    expect(f3.daysLeft ?? 99).toBeLessThanOrEqual(4);
    expect(f3.lowByThreshold).toBe(false);
    expect(f3.lowByForecast).toBe(true);
    expect(f3.lowReason).toBe('forecast');

    const two = new LedgerBuilder();
    two.restock(day(0), 10);
    two.consume(day(1), 4);
    two.consume(day(3), 4);
    const f2 = run(two, day(3) + HOUR_MS, { category: 'eau', product: { minQuantity: 0 } });
    expect(f2.daysLeft).toBeNull();
    expect(f2.lowByForecast).toBe(false);
    expect(f2.runningLow).toBe(false);
  });

  it('keeps the run-out date stable within a Paris day (scenario 15)', () => {
    const b = new LedgerBuilder();
    b.restock(day(0), 20);
    for (let d = 1; d <= 10; d++) b.consume(day(d), 1);
    const morning = startOfParisDay(day(12)) + 8 * HOUR_MS;
    const evening = startOfParisDay(day(12)) + 20 * HOUR_MS;
    const a = run(b, morning);
    const c = run(b, evening);
    expect(a.runOut?.median).toBe(c.runOut?.median);
    expect(c.daysLeft ?? 0).toBeLessThan(a.daysLeft ?? 0);
    expect(a.rate.asOf).toBe(referenceTime(morning, day(10)));
  });

  it('reports zero stock as out with daysLeft 0', () => {
    const b = new LedgerBuilder();
    b.restock(day(0), 2);
    b.consume(day(1), 1);
    b.consume(day(2), 1);
    const f = run(b, day(3));
    expect(f.daysLeft).toBe(0);
    expect(f.runOut).toBeNull();
    expect(f.lowReason).toBe('out');
  });

  it('tracks lastRestockAt (pending included) and lastSeq', () => {
    const b = new LedgerBuilder();
    b.restock(day(0), 2);
    b.consume(day(1), 1);
    b.restock(day(2), 3, { pending: true });
    const f = run(b, day(3));
    expect(f.lastRestockAt).toBe(day(2));
    expect(f.lastSeq).toBe(2);
  });

  it('is pure and never reads the clock (scenario 24)', () => {
    const spy = vi.spyOn(Date, 'now');
    const b = new LedgerBuilder();
    b.restock(day(0), 6);
    for (let d = 1; d < 5; d++) b.consume(day(d), 1);
    expect(run(b, day(6))).toEqual(run(b, day(6)));
    expect(spy).not.toHaveBeenCalled();
  });

  it('honours a custom config', () => {
    const b = new LedgerBuilder();
    b.restock(day(0), 6);
    for (let d = 1; d <= 3; d++) b.consume(day(d), 1);
    const input = {
      product: product({ minQuantity: 0 }),
      categoryKey: null,
      totalQuantity: b.total(),
      movements: b.movements,
      deletedPantryIds: NONE,
      householdHasCadence: false,
    };
    const strict = forecastProduct(input, day(4), CATEGORY_PRIORS, {
      ...DEFAULT_FORECAST_CONFIG,
      minEventsForForecast: 5,
    });
    expect(strict.runOut).toBeNull();
    expect(forecastProduct(input, day(4)).runOut).not.toBeNull();
  });
});

describe('performance (scenario 25)', () => {
  it('forecasts 300 products over 5 000 movements quickly', () => {
    const builders = Array.from({ length: 300 }, (_, i) => new LedgerBuilder(`p${i}` as typeof PRODUCT));
    for (let k = 0; k < 5000; k++) {
      const b = builders[k % 300];
      if (!b) continue;
      const t = day(Math.floor(k / 300) * 5);
      if (b.total() < 2) b.restock(t, 6);
      else b.consume(t, 1);
    }
    const now = day(90);
    const start = performance.now();
    for (const b of builders) {
      forecastProduct(
        {
          product: product({ id: b.productId }),
          categoryKey: null,
          totalQuantity: b.total(),
          movements: b.movements,
          deletedPantryIds: NONE,
          householdHasCadence: true,
        },
        now,
      );
    }
    // 04 §5.15 targets 50 ms on a phone; the bound here is loose to keep CI stable.
    expect(performance.now() - start).toBeLessThan(250);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
