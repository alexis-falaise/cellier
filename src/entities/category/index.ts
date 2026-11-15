/** Category selectors and hooks. A tombstoned category is shown as «Sans catégorie». */
import type { Category } from '@/domain/types';
import { useStore } from '@/shared/sync';
import { compareNames, createSelector, keyedSelector, type Selector } from '../lib/selector';
import { localizeCategory } from './localize';

export { localizeCategory };

const byOrder = (a: Category, b: Category) => a.sortOrder - b.sortOrder || compareNames(a.name, b.name);

/** Live categories by sortOrder, then name. */
export const selectCategories: Selector<readonly Category[]> = createSelector(
  (s) => [s.rows.category] as const,
  (categories) =>
    [...categories.values()]
      .filter((c) => c.deletedAt === null)
      .map(localizeCategory)
      .sort(byOrder),
);

export const selectDeletedCategories: Selector<readonly Category[]> = createSelector(
  (s) => [s.rows.category] as const,
  (categories) =>
    [...categories.values()]
      .filter((c) => c.deletedAt !== null)
      .map(localizeCategory)
      .sort(byOrder),
);

/** A live category by id, or null («Sans catégorie»). */
export const selectCategory = keyedSelector(
  (id: string): Selector<Category | null> =>
    (s) => {
      const c = s.rows.category.get(s.aliases.get(id) ?? id);
      return c && c.deletedAt === null ? localizeCategory(c) : null;
    },
);

export function useCategories(): readonly Category[] {
  return useStore(selectCategories);
}

export function useDeletedCategories(): readonly Category[] {
  return useStore(selectDeletedCategories);
}

export function useCategory(categoryId: string | null): Category | null {
  return useStore(categoryId ? selectCategory(categoryId) : selectNone);
}

const selectNone: Selector<null> = () => null;
