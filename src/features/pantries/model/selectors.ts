import { createSelector, type Selector } from '@/entities/lib/selector';
import { useStore } from '@/shared/sync';
import { countItems, type ItemCounts } from './pantries';

/** Items in stock per cellier and in the whole household («{n} articles»). */
export const selectItemCounts: Selector<ItemCounts> = createSelector(
  (s) => [s.rows.stock, s.rows.product, s.rows.pantry] as const,
  (stock, products, pantries) => {
    const liveProducts = new Set<string>();
    for (const p of products.values()) if (p.deletedAt === null) liveProducts.add(p.id);
    const livePantries = new Set<string>();
    for (const p of pantries.values()) if (p.deletedAt === null) livePantries.add(p.id);
    return countItems(stock.values(), liveProducts, livePantries);
  },
);

export function useItemCounts(): ItemCounts {
  return useStore(selectItemCounts);
}
