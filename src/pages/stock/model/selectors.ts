/**
 * Store selectors of the Stock screen. The search documents depend only on product and category
 * rows, so the MiniSearch index is not rebuilt when a quantity changes.
 */
import { createSelector, type Selector } from '@/entities/lib/selector';
import { type StockSearchDoc, toSearchDoc } from './search';

export const selectStockSearchDocs: Selector<readonly StockSearchDoc[]> = createSelector(
  (s) => [s.rows.product, s.rows.category] as const,
  (products, categories) => {
    const docs: StockSearchDoc[] = [];
    for (const p of products.values()) {
      if (p.deletedAt !== null) continue;
      const category = p.categoryId ? categories.get(p.categoryId) : undefined;
      docs.push(
        toSearchDoc({
          id: p.id,
          name: p.name,
          brand: p.brand,
          gtin: p.gtin,
          categoryName: category && category.deletedAt === null ? category.name : null,
        }),
      );
    }
    return docs;
  },
);
