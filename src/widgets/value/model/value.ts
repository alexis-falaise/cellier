/**
 * «Valeur du stock»: what the stock is worth at the products' unit prices, in total and per
 * category. A product without a price is counted apart, so the total never pretends to be complete.
 */
import type { Category, ProductView } from '@/domain/types';
import { compareFr } from '@/shared/i18n';

export interface CategoryValue {
  /** null = «Sans catégorie». */
  category: Category | null;
  cents: number;
  /** Share of the total, 0–1. */
  share: number;
  /** Products of this category in stock with a price. */
  priced: number;
}

export interface StockValue {
  totalCents: number;
  /** Products in stock with a price. */
  priced: number;
  /** Products in stock without a price. */
  unpriced: number;
  byCategory: CategoryValue[];
}

/** `pantryId` null = every live pantry. */
export function stockValue(views: readonly ProductView[], pantryId: string | null): StockValue {
  const groups = new Map<string | null, CategoryValue>();
  let totalCents = 0;
  let priced = 0;
  let unpriced = 0;
  for (const v of views) {
    if (v.product.deletedAt !== null) continue;
    const quantity =
      pantryId === null ? v.totalQuantity : (v.perPantry.find((p) => p.pantryId === pantryId)?.quantity ?? 0);
    if (quantity <= 0) continue;
    if (v.product.priceCents === null) {
      unpriced += 1;
      continue;
    }
    const cents = quantity * v.product.priceCents;
    priced += 1;
    totalCents += cents;
    const key = v.category?.id ?? null;
    const g = groups.get(key) ?? { category: v.category, cents: 0, share: 0, priced: 0 };
    g.cents += cents;
    g.priced += 1;
    groups.set(key, g);
  }
  const byCategory = [...groups.values()]
    .map((g) => ({ ...g, share: totalCents > 0 ? g.cents / totalCents : 0 }))
    .sort((a, b) => b.cents - a.cents || compareFr(a.category?.name ?? '', b.category?.name ?? ''));
  return { totalCents, priced, unpriced, byCategory };
}
