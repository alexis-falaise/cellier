/** Product selectors: products with household totals (ProductView), lookups, running low. */
import type { Category, Gtin, Pantry, PantryId, Product, ProductView, StockRow } from '@/domain/types';
import { compareFr, createSelector, keyedSelector, type Selector } from '../lib/selector';

/** Product ids with a queued mutation touching the product or one of its stock rows. */
export const selectPendingProductIds: Selector<ReadonlySet<string>> = createSelector(
  (s) => [s.pendingKeys] as const,
  (keys) => {
    const ids = new Set<string>();
    for (const k of keys) {
      if (k.startsWith('product/')) ids.add(k.slice('product/'.length));
      else if (k.startsWith('stock/')) ids.add(k.slice(k.indexOf(':') + 1));
    }
    return ids;
  },
);

/** Live (not deleted) pantries by id. */
export const selectLivePantryIds: Selector<ReadonlySet<string>> = createSelector(
  (s) => [s.rows.pantry] as const,
  (pantries) => new Set([...pantries.values()].filter((p: Pantry) => p.deletedAt === null).map((p) => p.id)),
);

/** Created-at of the newest restock per product. */
const selectLastRestock: Selector<ReadonlyMap<string, string>> = createSelector(
  (s) => [s.rows.movement] as const,
  (movements) => {
    const out = new Map<string, string>();
    for (const m of movements.values()) {
      if (m.kind !== 'restock') continue;
      const prev = out.get(m.productId);
      if (!prev || prev < m.createdAt) out.set(m.productId, m.createdAt);
    }
    return out;
  },
);

/** Stock rows of live pantries, by product. */
const selectStockByProduct: Selector<ReadonlyMap<string, StockRow[]>> = createSelector(
  (s) => [s.rows.stock, selectLivePantryIds(s)] as const,
  (stock, live) => {
    const out = new Map<string, StockRow[]>();
    for (const row of stock.values()) {
      if (!live.has(row.pantryId)) continue;
      const list = out.get(row.productId);
      if (list) list.push(row);
      else out.set(row.productId, [row]);
    }
    return out;
  },
);

let viewCache = new Map<string, ProductView>();

function liveCategory(categories: ReadonlyMap<string, Category>, id: string | null): Category | null {
  if (!id) return null;
  const c = categories.get(id);
  return c && c.deletedAt === null ? c : null;
}

/** ProductView of every product (deleted ones included), by id. Unchanged products keep their object. */
export const selectProductViewMap: Selector<ReadonlyMap<string, ProductView>> = createSelector(
  (s) =>
    [
      s.rows.product,
      s.rows.category,
      selectStockByProduct(s),
      selectLastRestock(s),
      selectPendingProductIds(s),
      s.rows.pantry,
    ] as const,
  (products, categories, stockByProduct, lastRestock, pending, pantries) => {
    const next = new Map<string, ProductView>();
    for (const product of products.values()) {
      const rows = stockByProduct.get(product.id) ?? [];
      const perPantry = rows
        .map((r) => ({ pantryId: r.pantryId as PantryId, quantity: r.quantity }))
        .sort((a, b) => (pantries.get(a.pantryId)?.sortOrder ?? 0) - (pantries.get(b.pantryId)?.sortOrder ?? 0));
      const view: ProductView = {
        product,
        category: liveCategory(categories, product.categoryId),
        totalQuantity: rows.reduce((sum, r) => sum + r.quantity, 0),
        perPantry,
        lastRestockAt: lastRestock.get(product.id) ?? null,
        pending: pending.has(product.id),
      };
      const prev = viewCache.get(product.id);
      if (
        prev &&
        prev.product === view.product &&
        prev.category === view.category &&
        prev.totalQuantity === view.totalQuantity &&
        prev.lastRestockAt === view.lastRestockAt &&
        prev.pending === view.pending &&
        prev.perPantry.length === perPantry.length &&
        prev.perPantry.every((p, i) => p.pantryId === perPantry[i]?.pantryId && p.quantity === perPantry[i]?.quantity)
      ) {
        next.set(product.id, prev);
      } else {
        next.set(product.id, view);
      }
    }
    viewCache = next;
    return next;
  },
);

/** Live products with their household total, sorted by name (French collation). */
export const selectProductViews: Selector<readonly ProductView[]> = createSelector(
  (s) => [selectProductViewMap(s)] as const,
  (map) =>
    [...map.values()]
      .filter((v) => v.product.deletedAt === null)
      .sort((a, b) => compareFr(a.product.name, b.product.name)),
);

/** Deleted products (for «Restaurer»). */
export const selectDeletedProducts: Selector<readonly Product[]> = createSelector(
  (s) => [s.rows.product] as const,
  (products) => [...products.values()].filter((p) => p.deletedAt !== null).sort((a, b) => compareFr(a.name, b.name)),
);

/** One product view by id (aliases resolved), or undefined. */
export const selectProductView = keyedSelector(
  (id: string): Selector<ProductView | undefined> =>
    (s) =>
      selectProductViewMap(s).get(s.aliases.get(id) ?? id),
);

/** Live product by scanned GTIN (natural key). */
export const selectProductsByGtin: Selector<ReadonlyMap<string, Product>> = createSelector(
  (s) => [s.rows.product] as const,
  (products) => {
    const out = new Map<string, Product>();
    for (const p of products.values()) if (p.gtin && p.deletedAt === null) out.set(p.gtin, p);
    return out;
  },
);

export const selectProductByGtin =
  (gtin: Gtin | string): Selector<Product | undefined> =>
  (s) =>
    selectProductsByGtin(s).get(gtin);

/** Effective minimum (04-notifications-forecasting.md): `minQuantity ?? max(1, ceil(usual / 4)) ?? 1`. */
export function effectiveMinimum(product: Product): number {
  if (product.minQuantity !== null) return product.minQuantity;
  if (product.usualQuantity !== null) return Math.max(1, Math.ceil(0.25 * product.usualQuantity));
  return 1;
}

/** Running low by threshold (the forecast rule lives in the forecasting package). A seuil of 0 is never low. */
export function isLowByThreshold(view: ProductView): boolean {
  const minimum = effectiveMinimum(view.product);
  return view.product.lowAlert && view.product.deletedAt === null && minimum > 0 && view.totalQuantity <= minimum;
}

export const selectLowProducts: Selector<readonly ProductView[]> = createSelector(
  (s) => [selectProductViews(s)] as const,
  (views) => views.filter(isLowByThreshold),
);

/** Live products of one category (null = «Sans catégorie», including tombstoned categories). */
export const selectProductViewsByCategory = keyedSelector((categoryId: string | null) =>
  createSelector(
    (s) => [selectProductViews(s)] as const,
    (views) => views.filter((v) => (v.category?.id ?? null) === categoryId),
  ),
);
