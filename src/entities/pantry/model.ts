/** Pantry selectors: live pantries in display order, and the stock of one pantry. */
import type { Pantry, ProductView } from '@/domain/types';
import { stockKey } from '@/domain/types';
import { compareFr, createSelector, keyedSelector, type Selector } from '../lib/selector';
import { selectProductViews } from '../product/model';

const byOrder = (a: Pantry, b: Pantry) => a.sortOrder - b.sortOrder || compareFr(a.name, b.name);

/** Live pantries by sortOrder, then name. */
export const selectPantries: Selector<readonly Pantry[]> = createSelector(
  (s) => [s.rows.pantry] as const,
  (pantries) => [...pantries.values()].filter((p) => p.deletedAt === null).sort(byOrder),
);

/** Deleted pantries (for «Restaurer»). */
export const selectDeletedPantries: Selector<readonly Pantry[]> = createSelector(
  (s) => [s.rows.pantry] as const,
  (pantries) => [...pantries.values()].filter((p) => p.deletedAt !== null).sort(byOrder),
);

export const selectPantry = keyedSelector(
  (id: string): Selector<Pantry | undefined> =>
    (s) =>
      s.rows.pantry.get(s.aliases.get(id) ?? id),
);

export interface PantryStockItem {
  view: ProductView;
  quantity: number;
}

/** Live products with a stock row in this pantry (quantity 0 included), sorted by product name. */
export const selectPantryStock = keyedSelector((pantryId: string) => {
  let cache = new Map<string, PantryStockItem>();
  return createSelector(
    (s) => [selectProductViews(s), s.rows.stock, s.aliases.get(pantryId) ?? pantryId] as const,
    (views, stock, id) => {
      const next = new Map<string, PantryStockItem>();
      const items: PantryStockItem[] = [];
      for (const view of views) {
        const row = stock.get(stockKey(id as Pantry['id'], view.product.id));
        if (!row) continue;
        const prev = cache.get(view.product.id);
        const item =
          prev && prev.view === view && prev.quantity === row.quantity ? prev : { view, quantity: row.quantity };
        next.set(view.product.id, item);
        items.push(item);
      }
      cache = next;
      return items;
    },
  );
});
