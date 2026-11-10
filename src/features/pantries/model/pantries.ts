/**
 * Cellier rules (design 03 §4.9): unique names, household order, item counts, and what happens
 * to the stock of a deleted cellier (moved to another cellier first, or deleted with it).
 */
import type { MutationArgs, PantryId, ProductId } from '@/domain/types';
import { fold } from '@/shared/i18n';

export const SORT_STEP = 10;

export type PantryNameError = 'required' | 'taken';

/** Names are unique per household, ignoring case and accents. */
export function validatePantryName(
  name: string,
  pantries: ReadonlyArray<{ id: string; name: string }>,
  selfId: string | null,
): PantryNameError | null {
  const key = fold(name.trim());
  if (!key) return 'required';
  return pantries.some((p) => p.id !== selfId && fold(p.name.trim()) === key) ? 'taken' : null;
}

export function nextSortOrder(pantries: ReadonlyArray<{ sortOrder: number }>): number {
  return pantries.reduce((max, p) => Math.max(max, p.sortOrder), 0) + SORT_STEP;
}

export interface SortUpdate {
  id: string;
  sortOrder: number;
}

/**
 * `sortOrder` writes that move `list[from]` to index `to`: only the moved row when there is room
 * between its new neighbours, otherwise the whole list renumbered in steps of 10.
 */
export function reorderPlan(
  list: ReadonlyArray<{ id: string; sortOrder: number }>,
  from: number,
  to: number,
): SortUpdate[] {
  if (from === to || from < 0 || from >= list.length) return [];
  const next = [...list];
  const [moved] = next.splice(from, 1);
  if (!moved) return [];
  const index = Math.max(0, Math.min(next.length, to));
  next.splice(index, 0, moved);
  const before = next[index - 1]?.sortOrder;
  const after = next[index + 1]?.sortOrder;
  let slot: number | null = null;
  if (before === undefined && after !== undefined) slot = after - SORT_STEP;
  else if (after === undefined && before !== undefined) slot = before + SORT_STEP;
  else if (before !== undefined && after !== undefined && after - before >= 2) slot = Math.floor((before + after) / 2);
  if (slot !== null) return [{ id: moved.id, sortOrder: slot }];
  return next.flatMap((p, i) =>
    p.sortOrder === (i + 1) * SORT_STEP ? [] : [{ id: p.id, sortOrder: (i + 1) * SORT_STEP }],
  );
}

export interface ItemCounts {
  byPantry: ReadonlyMap<string, number>;
  /** Distinct products in stock in any live cellier. */
  all: number;
}

/** Products with a positive quantity, per cellier and overall (live products and celliers only). */
export function countItems(
  stock: Iterable<{ pantryId: string; productId: string; quantity: number }>,
  liveProducts: ReadonlySet<string>,
  livePantries: ReadonlySet<string>,
): ItemCounts {
  const byPantry = new Map<string, number>();
  const all = new Set<string>();
  for (const row of stock) {
    if (row.quantity <= 0 || !liveProducts.has(row.productId) || !livePantries.has(row.pantryId)) continue;
    byPantry.set(row.pantryId, (byPantry.get(row.pantryId) ?? 0) + 1);
    all.add(row.productId);
  }
  return { byPantry, all: all.size };
}

/** «Déplacer le stock, puis supprimer»: one transfer per product still on the shelves of `from`. */
export function moveStockPlan(
  from: string,
  to: string,
  rows: ReadonlyArray<{ productId: string; quantity: number }>,
): MutationArgs['stock.transfer'][] {
  if (from === to) return [];
  return rows
    .filter((r) => r.quantity > 0)
    .map((r) => ({
      fromPantryId: from as PantryId,
      toPantryId: to as PantryId,
      productId: r.productId as ProductId,
      quantity: Math.round(r.quantity),
      source: 'form' as const,
    }));
}
