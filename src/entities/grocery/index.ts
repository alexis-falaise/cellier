/**
 * Courses selectors. Running-low suggestions have no row until dismissed (00-decisions); the
 * suggestion list itself belongs to the forecasting package and can use `selectDismissedProductIds`.
 */
import type { GroceryEntry } from '@/domain/types';
import { useStore } from '@/shared/sync';
import { createSelector, type Selector } from '../lib/selector';

const isOpen = (g: GroceryEntry) => g.deletedAt === null && g.checkedAt === null && g.dismissedAt === null;
const byCreated = (a: GroceryEntry, b: GroceryEntry) =>
  a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

/** Entries to buy (unchecked, not dismissed, not deleted), oldest first. */
export const selectOpenGroceryEntries: Selector<readonly GroceryEntry[]> = createSelector(
  (s) => [s.rows.grocery] as const,
  (rows) => [...rows.values()].filter(isOpen).sort(byCreated),
);

/** Checked entries (in the basket), most recently checked first. */
export const selectCheckedGroceryEntries: Selector<readonly GroceryEntry[]> = createSelector(
  (s) => [s.rows.grocery] as const,
  (rows) =>
    [...rows.values()]
      .filter((g) => g.deletedAt === null && g.checkedAt !== null)
      .sort((a, b) => (b.checkedAt ?? '').localeCompare(a.checkedAt ?? '')),
);

/** Products whose suggestion was dismissed and not yet bought again. */
export const selectDismissedProductIds: Selector<ReadonlySet<string>> = createSelector(
  (s) => [s.rows.grocery] as const,
  (rows) => {
    const ids = new Set<string>();
    for (const g of rows.values()) {
      if (g.productId && g.deletedAt === null && g.dismissedAt !== null && g.checkedAt === null) ids.add(g.productId);
    }
    return ids;
  },
);

/** Open entry by product id (natural key: at most one). */
export const selectOpenGroceryByProduct: Selector<ReadonlyMap<string, GroceryEntry>> = createSelector(
  (s) => [selectOpenGroceryEntries(s)] as const,
  (open) => new Map(open.filter((g) => g.productId).map((g) => [g.productId as string, g])),
);

export function useOpenGroceryEntries(): readonly GroceryEntry[] {
  return useStore(selectOpenGroceryEntries);
}

export function useCheckedGroceryEntries(): readonly GroceryEntry[] {
  return useStore(selectCheckedGroceryEntries);
}

export function useDismissedProductIds(): ReadonlySet<string> {
  return useStore(selectDismissedProductIds);
}

export function useOpenGroceryEntryForProduct(productId: string): GroceryEntry | undefined {
  return useStore((s) => selectOpenGroceryByProduct(s).get(s.aliases.get(productId) ?? productId));
}
