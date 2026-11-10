/**
 * Household forecasts for Accueil and Courses (04-notifications-forecasting.md §5.15): one
 * `forecastProduct` per product, memoised on the product's own inputs, plus the cadence, the next
 * trip and the merged Courses list. Pure derivations over store data; no I/O.
 */
import { useMemo } from 'react';
import type { GroceryEntry, Movement, PantryId, ProductId, ProductView } from '@/domain/types';
import { createSelector, type Selector, sameArray } from '@/entities/lib/selector';
import { useProductViews } from '@/entities/product';
import {
  type Cadence,
  forecastProduct,
  type GroceryList,
  groceryList,
  householdRestockTimes,
  type LedgerMovement,
  type NextTrip,
  nextTrip,
  type ProductForecast,
  shoppingCadence,
} from '@/features/forecast';
import { useStore } from '@/shared/sync';
import { useNow } from './useNow';

const ledgerCache = new WeakMap<Movement, LedgerMovement>();

/** The forecast's view of a store movement (pending rows have `seq = Infinity` in the store). */
export function toLedgerMovement(m: Movement): LedgerMovement {
  let out = ledgerCache.get(m);
  if (!out) {
    out = {
      id: m.id,
      pantryId: m.pantryId,
      productId: m.productId,
      kind: m.kind,
      appliedDelta: m.appliedDelta,
      quantityAfter: m.quantityAfter,
      revertsId: m.revertsId,
      clientAt: m.clientAt,
      createdAt: m.createdAt,
      seq: Number.isFinite(m.seq) ? m.seq : null,
    };
    ledgerCache.set(m, out);
  }
  return out;
}

interface Ledger {
  all: readonly LedgerMovement[];
  byProduct: ReadonlyMap<string, readonly LedgerMovement[]>;
}

let previousByProduct: ReadonlyMap<string, readonly LedgerMovement[]> = new Map();

/** Every movement as a ledger row, and per product (per-product arrays keep their identity when unchanged). */
const selectLedger: Selector<Ledger> = createSelector(
  (s) => [s.rows.movement] as const,
  (movements) => {
    const all = [...movements.values()].map(toLedgerMovement);
    const grouped = new Map<string, LedgerMovement[]>();
    for (const m of all) {
      const list = grouped.get(m.productId);
      if (list) list.push(m);
      else grouped.set(m.productId, [m]);
    }
    const byProduct = new Map<string, readonly LedgerMovement[]>();
    for (const [id, list] of grouped) {
      const prev = previousByProduct.get(id);
      byProduct.set(id, prev && sameArray(prev, list) ? prev : list);
    }
    previousByProduct = byProduct;
    return { all, byProduct };
  },
);

const selectDeletedPantryIds: Selector<ReadonlySet<PantryId>> = createSelector(
  (s) => [s.rows.pantry] as const,
  (pantries) => new Set([...pantries.values()].filter((p) => p.deletedAt !== null).map((p) => p.id)),
);

/** Every grocery row (open, checked, dismissed); `groceryList` sorts them out. */
const selectGroceryRows: Selector<readonly GroceryEntry[]> = createSelector(
  (s) => [s.rows.grocery] as const,
  (rows) => [...rows.values()],
);

const EMPTY: readonly LedgerMovement[] = [];

interface CacheEntry {
  view: ProductView;
  movements: readonly LedgerMovement[];
  deleted: ReadonlySet<PantryId>;
  hasCadence: boolean;
  now: number;
  result: ProductForecast;
}

const forecastCache = new Map<string, CacheEntry>();

function cachedForecast(
  view: ProductView,
  movements: readonly LedgerMovement[],
  deleted: ReadonlySet<PantryId>,
  hasCadence: boolean,
  now: number,
): ProductForecast {
  const hit = forecastCache.get(view.product.id);
  if (
    hit &&
    hit.view === view &&
    hit.movements === movements &&
    hit.deleted === deleted &&
    hit.hasCadence === hasCadence &&
    hit.now === now
  ) {
    return hit.result;
  }
  const result = forecastProduct(
    {
      product: view.product,
      categoryKey: view.category?.templateKey ?? null,
      totalQuantity: view.totalQuantity,
      movements,
      deletedPantryIds: deleted,
      householdHasCadence: hasCadence,
    },
    now,
  );
  forecastCache.set(view.product.id, { view, movements, deleted, hasCadence, now, result });
  return result;
}

export interface HouseholdForecasts {
  now: number;
  views: readonly ProductView[];
  viewsById: ReadonlyMap<string, ProductView>;
  forecasts: readonly ProductForecast[];
  forecastsById: ReadonlyMap<string, ProductForecast>;
  names: ReadonlyMap<ProductId, string>;
  cadence: Cadence | null;
  trip: NextTrip;
}

export function computeHouseholdForecasts(
  views: readonly ProductView[],
  ledger: Ledger,
  deleted: ReadonlySet<PantryId>,
  now: number,
): HouseholdForecasts {
  const cadence = shoppingCadence(householdRestockTimes(ledger.all, deleted), now);
  const hasCadence = cadence !== null;
  const forecasts = views.map((v) =>
    cachedForecast(v, ledger.byProduct.get(v.product.id) ?? EMPTY, deleted, hasCadence, now),
  );
  return {
    now,
    views,
    viewsById: new Map(views.map((v) => [v.product.id, v])),
    forecasts,
    forecastsById: new Map(forecasts.map((f) => [f.productId, f])),
    names: new Map(views.map((v) => [v.product.id, v.product.name])),
    cadence,
    trip: nextTrip(cadence, forecasts, now),
  };
}

/** Forecasts of every live product, the household cadence and the next trip. */
export function useHouseholdForecasts(): HouseholdForecasts {
  const views = useProductViews();
  const ledger = useStore(selectLedger);
  const deleted = useStore(selectDeletedPantryIds);
  const now = useNow();
  return useMemo(() => computeHouseholdForecasts(views, ledger, deleted, now), [views, ledger, deleted, now]);
}

/** The Courses list (suggestions merged with the household's rows) for the given forecasts. */
export function useGroceryList(h: HouseholdForecasts): GroceryList {
  const entries = useStore(selectGroceryRows);
  return useMemo(
    () => groceryList({ forecasts: h.forecasts, names: h.names, entries, trip: h.trip, now: h.now }),
    [h, entries],
  );
}
