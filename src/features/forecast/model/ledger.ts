import type { PantryId, ProductId } from '@/domain/types';
import { DEFAULT_FORECAST_CONFIG } from './config';
import { DAY_MS } from './time';
import type { DemandEvent, EpochMs, LedgerMovement, TotalPoint, TotalSeries } from './types';

/**
 * Effective time of one movement before ordering (§5.2): server rows trust the device clock for at
 * most `trustDays` before the server apply time; pending rows use their client time.
 */
export function movementTime(m: LedgerMovement, trustDays = DEFAULT_FORECAST_CONFIG.clientTimeTrustDays): EpochMs {
  const created = Date.parse(m.createdAt);
  const client = m.clientAt === null ? Number.NaN : Date.parse(m.clientAt);
  if (m.seq === null) return Number.isFinite(client) ? client : created;
  if (!Number.isFinite(client)) return created;
  return Math.min(created, Math.max(created - trustDays * DAY_MS, client));
}

/** Server rows by `seq`, then pending rows in the order given (outbox order). Stable. */
export function orderLedger(movements: readonly LedgerMovement[]): LedgerMovement[] {
  return movements
    .map((m, i) => ({ m, i }))
    .sort((a, b) => {
      const sa = a.m.seq ?? Number.POSITIVE_INFINITY;
      const sb = b.m.seq ?? Number.POSITIVE_INFINITY;
      return sa === sb ? a.i - b.i : sa - sb;
    })
    .map(({ m }) => m);
}

/** §5.2. Household total step function of one product, from the ledger ordered by seq. */
export function reconstructTotals(
  productId: ProductId,
  movements: readonly LedgerMovement[],
  deletedPantryIds: ReadonlySet<PantryId>,
  trustDays = DEFAULT_FORECAST_CONFIG.clientTimeTrustDays,
): TotalSeries {
  const own = orderLedger(movements.filter((m) => m.productId === productId && !deletedPantryIds.has(m.pantryId)));
  const perPantry = new Map<PantryId, number>();
  let initialTotal = 0;
  let total = 0;
  let last = Number.NEGATIVE_INFINITY;
  const points: TotalPoint[] = [];
  for (const m of own) {
    const before = perPantry.get(m.pantryId);
    if (before === undefined) {
      const previous = m.quantityAfter - m.appliedDelta;
      initialTotal += previous;
      total += previous;
    }
    total += m.quantityAfter - (before ?? m.quantityAfter - m.appliedDelta);
    perPantry.set(m.pantryId, m.quantityAfter);
    last = Math.max(last, movementTime(m, trustDays));
    points.push({ at: last, total, movementId: m.id, kind: m.kind });
  }
  return { productId, initialTotal, points };
}

/** §5.3. 'consume' movements with appliedDelta < 0 that no correction reverts, at their effective time. */
export function demandEvents(series: TotalSeries, movements: readonly LedgerMovement[]): DemandEvent[] {
  const byId = new Map<string, LedgerMovement>();
  const reverted = new Set<string>();
  for (const m of movements) {
    byId.set(m.id, m);
    if (m.revertsId !== null) reverted.add(m.revertsId);
  }
  const events: DemandEvent[] = [];
  for (const p of series.points) {
    if (p.kind !== 'consume' || reverted.has(p.movementId)) continue;
    const m = byId.get(p.movementId);
    if (m && m.appliedDelta < 0) events.push({ at: p.at, quantity: -m.appliedDelta });
  }
  return events;
}

/**
 * §5.8 input. Effective times of every restock with appliedDelta > 0 of the household (all products,
 * live pantries), sorted ascending.
 */
export function householdRestockTimes(
  movements: readonly LedgerMovement[],
  deletedPantryIds: ReadonlySet<PantryId>,
  trustDays = DEFAULT_FORECAST_CONFIG.clientTimeTrustDays,
): EpochMs[] {
  const times: EpochMs[] = [];
  for (const m of movements) {
    if (m.kind === 'restock' && m.appliedDelta > 0 && !deletedPantryIds.has(m.pantryId)) {
      times.push(movementTime(m, trustDays));
    }
  }
  return times.sort((a, b) => a - b);
}
