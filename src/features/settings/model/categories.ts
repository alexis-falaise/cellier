/**
 * Category rules of Réglages › Catégories (design 03 §4.13). The database stores per category a
 * template key, a name, an order and optional icon and colour overrides; it has no "hidden" flag,
 * so hiding a default category is a tombstone (`category.delete`) and showing it is a restore.
 */
import type { Category, CategoryId, ProductId } from '@/domain/types';
import { fold } from '@/shared/i18n';

export const SORT_STEP = 10;

export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (from < 0 || from >= next.length) return next;
  const [item] = next.splice(from, 1) as [T];
  next.splice(Math.max(0, Math.min(next.length, to)), 0, item);
  return next;
}

export interface SortUpdate {
  id: CategoryId;
  sortOrder: number;
}

/**
 * The `sortOrder` writes that move `list[from]` to index `to`. When there is room between the new
 * neighbours only the moved row changes; otherwise the whole list is renumbered in steps of 10.
 */
export function reorderPlan(
  list: ReadonlyArray<Pick<Category, 'id' | 'sortOrder'>>,
  from: number,
  to: number,
): SortUpdate[] {
  if (from === to || from < 0 || from >= list.length) return [];
  const next = moveItem(list, from, to);
  const index = next.indexOf(list[from] as Pick<Category, 'id' | 'sortOrder'>);
  const before = next[index - 1]?.sortOrder;
  const after = next[index + 1]?.sortOrder;
  const moved = next[index] as Pick<Category, 'id' | 'sortOrder'>;
  let slot: number | null = null;
  if (before === undefined && after !== undefined) slot = after - SORT_STEP;
  else if (after === undefined && before !== undefined) slot = before + SORT_STEP;
  else if (before !== undefined && after !== undefined && after - before >= 2) slot = Math.floor((before + after) / 2);
  if (slot !== null) return [{ id: moved.id, sortOrder: slot }];
  return next.flatMap((c, i) =>
    c.sortOrder === (i + 1) * SORT_STEP ? [] : [{ id: c.id, sortOrder: (i + 1) * SORT_STEP }],
  );
}

/** Order for a new category: after the last one. */
export function nextSortOrder(list: ReadonlyArray<Pick<Category, 'sortOrder'>>): number {
  return list.reduce((max, c) => Math.max(max, c.sortOrder), 0) + SORT_STEP;
}

export type CategoryNameError = 'required' | 'taken';

/** Names are unique per household, ignoring case and accents (as the database's `name_key`). */
export function validateCategoryName(
  name: string,
  categories: ReadonlyArray<Pick<Category, 'id' | 'name'>>,
  selfId: string | null,
): CategoryNameError | null {
  const key = fold(name.trim());
  if (!key) return 'required';
  return categories.some((c) => c.id !== selfId && fold(c.name.trim()) === key) ? 'taken' : null;
}

/** «Autres» (template `autre`) is never hidden; other defaults hide; custom categories are deleted. */
export function categoryKind(category: Pick<Category, 'templateKey'>): 'others' | 'default' | 'custom' {
  if (category.templateKey === 'autre') return 'others';
  return category.templateKey ? 'default' : 'custom';
}

/**
 * Products to move into «Autres» before a custom category is deleted (03 §4.13.2: «Ses {n} articles
 * passeront dans « Autres »»). Without it they would show as «Sans catégorie».
 */
export function productsToReassign(
  categoryId: CategoryId,
  products: ReadonlyArray<{ id: ProductId; categoryId: CategoryId | null; deletedAt: string | null }>,
): ProductId[] {
  return products.filter((p) => p.categoryId === categoryId && p.deletedAt === null).map((p) => p.id);
}
