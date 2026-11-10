/**
 * Ledger selectors for Activité and product history: movements newest first, pending ones (not yet
 * confirmed by the server, `seq = Infinity`) on top with `pending: true`.
 */
import type { Movement } from '@/domain/types';
import { type ActivityEntry, useStore } from '@/shared/sync';
import { createSelector, keyedSelector, type Selector } from '../lib/selector';

export interface MovementView {
  movement: Movement;
  pending: boolean;
}

let viewCache = new Map<string, MovementView>();

function compareMovements(a: Movement, b: Movement): number {
  if (a.seq === b.seq) return b.createdAt.localeCompare(a.createdAt);
  if (a.seq === Infinity) return -1;
  if (b.seq === Infinity) return 1;
  return b.seq - a.seq;
}

/** Every movement in the store, newest first. */
export const selectMovements: Selector<readonly MovementView[]> = createSelector(
  (s) => [s.rows.movement] as const,
  (movements) => {
    const next = new Map<string, MovementView>();
    const list = [...movements.values()].sort(compareMovements).map((movement) => {
      const prev = viewCache.get(movement.id);
      const view = prev && prev.movement === movement ? prev : { movement, pending: movement.seq === Infinity };
      next.set(movement.id, view);
      return view;
    });
    viewCache = next;
    return list;
  },
);

/** The newest `limit` movements. */
export const selectRecentMovements = keyedSelector((limit: number) =>
  createSelector(
    (s) => [selectMovements(s)] as const,
    (all) => all.slice(0, limit),
  ),
);

/** Movements of one product (aliases resolved), newest first. */
export const selectProductMovements = keyedSelector((productId: string) =>
  createSelector(
    (s) => [selectMovements(s), s.aliases.get(productId) ?? productId] as const,
    (all, id) => all.filter((v) => v.movement.productId === id),
  ),
);

/** Movements of one pantry, newest first. */
export const selectPantryMovements = keyedSelector((pantryId: string) =>
  createSelector(
    (s) => [selectMovements(s), s.aliases.get(pantryId) ?? pantryId] as const,
    (all, id) => all.filter((v) => v.movement.pantryId === id),
  ),
);

/** Local conflict notes (clamped, recount adjusted, lost values…), newest first. */
export const selectActivityEntries: Selector<readonly ActivityEntry[]> = createSelector(
  (s) => [s.activity] as const,
  (activity) => [...activity].reverse(),
);

export const selectUnreadActivityCount: Selector<number> = (s) => s.activity.filter((a) => !a.read).length;

export function useMovements(): readonly MovementView[] {
  return useStore(selectMovements);
}

export function useRecentMovements(limit = 50): readonly MovementView[] {
  return useStore(selectRecentMovements(limit));
}

export function useProductMovements(productId: string): readonly MovementView[] {
  return useStore(selectProductMovements(productId));
}

export function usePantryMovements(pantryId: string): readonly MovementView[] {
  return useStore(selectPantryMovements(pantryId));
}

export function useActivityEntries(): readonly ActivityEntry[] {
  return useStore(selectActivityEntries);
}

export function useUnreadActivityCount(): number {
  return useStore(selectUnreadActivityCount);
}
