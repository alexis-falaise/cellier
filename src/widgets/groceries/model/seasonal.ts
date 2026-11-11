/**
 * Seasonal suggestions on Courses: the Courses list and the household's products read as seasonal
 * foods, and the device's dismissals of the month.
 */
import { useMemo, useSyncExternalStore } from 'react';
import type { ProductView } from '@/domain/types';
import { type GroceryList, parisDate } from '@/features/forecast';
import {
  foodOf,
  foodOfProduct,
  type KnownFood,
  type ListedFood,
  type MonthIndex,
  monthIndex,
  type SeasonalSuggestion,
  seasonalSuggestions,
} from '@/features/seasonal';
import type { HouseholdForecasts } from './householdForecasts';
import { itemName } from './presentation';

/** Paris month of `t` as a running index. */
export function parisMonth(t: number): MonthIndex {
  const [y = '0', m = '1'] = parisDate(t).split('-');
  return monthIndex(Number(y), Number(m));
}

export function listedFoods(list: GroceryList, viewsById: ReadonlyMap<string, ProductView>): ListedFood[] {
  return [...list.toBuy, ...list.inCart].map((item) => {
    let slug: string | null;
    if (item.kind === 'label') slug = foodOf(item.label);
    else {
      const v = viewsById.get(item.productId);
      slug = v ? productFood(v) : null;
    }
    return { ref: item.key, name: itemName(item), slug, checked: item.checked };
  });
}

function productFood(v: ProductView): string | null {
  return foodOfProduct({ kind: v.product.kind, name: v.product.name, categoryKey: v.category?.templateKey ?? null });
}

export function knownFoods(views: readonly ProductView[]): KnownFood[] {
  const out: KnownFood[] = [];
  for (const v of views) {
    if (v.product.deletedAt !== null) continue;
    const slug = productFood(v);
    if (!slug) continue;
    const at = v.lastRestockAt === null ? Number.NaN : Date.parse(v.lastRestockAt);
    out.push({
      productId: v.product.id,
      slug,
      inStock: v.totalQuantity > 0,
      lastBoughtAt: Number.isFinite(at) ? at : null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Dismissals: per device, for the current month only (next month brings other foods)
// ---------------------------------------------------------------------------------------------

const KEY = 'cellier:seasonal-dismissed';

interface Stored {
  month: MonthIndex;
  slugs: string[];
}

const EMPTY: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();
let cached: Stored | null = null;

function readStored(): Stored | null {
  if (cached) return cached;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as unknown;
    if (raw && typeof raw === 'object') {
      const r = raw as Record<string, unknown>;
      if (typeof r.month === 'number' && Array.isArray(r.slugs)) {
        cached = { month: r.month, slugs: r.slugs.filter((s): s is string => typeof s === 'string') };
      }
    }
  } catch {
    // Storage unavailable or corrupt: nothing dismissed.
  }
  return cached;
}

let snapshot: { month: MonthIndex; set: ReadonlySet<string> } | null = null;

function dismissedFor(month: MonthIndex): ReadonlySet<string> {
  const stored = readStored();
  if (!stored || stored.month !== month) return EMPTY;
  if (!snapshot || snapshot.month !== month) snapshot = { month, set: new Set(stored.slugs) };
  return snapshot.set;
}

export function dismissSeasonal(month: MonthIndex, slug: string): void {
  const stored = readStored();
  const slugs = stored && stored.month === month ? stored.slugs.filter((s) => s !== slug) : [];
  cached = { month, slugs: [...slugs, slug] };
  snapshot = null;
  try {
    localStorage.setItem(KEY, JSON.stringify(cached));
  } catch {
    // Kept in memory for this session.
  }
  for (const l of [...listeners]) l();
}

export function undismissSeasonal(month: MonthIndex, slug: string): void {
  const stored = readStored();
  if (!stored || stored.month !== month) return;
  cached = { month, slugs: stored.slugs.filter((s) => s !== slug) };
  snapshot = null;
  try {
    localStorage.setItem(KEY, JSON.stringify(cached));
  } catch {
    // Kept in memory for this session.
  }
  for (const l of [...listeners]) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test helper. */
export function resetSeasonalDismissalsForTests(): void {
  cached = null;
  snapshot = null;
}

export interface SeasonalView {
  month: MonthIndex;
  suggestions: SeasonalSuggestion[];
}

/** Seasonal suggestions for the current Courses list. */
export function useSeasonalSuggestions(
  list: GroceryList,
  h: Pick<HouseholdForecasts, 'views' | 'viewsById' | 'now'>,
): SeasonalView {
  const { views, viewsById } = h;
  const month = parisMonth(h.now);
  const dismissed = useSyncExternalStore(
    subscribe,
    () => dismissedFor(month),
    () => EMPTY,
  );
  return useMemo(() => {
    return {
      month,
      suggestions: seasonalSuggestions({
        now: month,
        listed: listedFoods(list, viewsById),
        known: knownFoods(views),
        dismissed,
        monthOfTime: parisMonth,
      }),
    };
  }, [list, views, viewsById, month, dismissed]);
}
