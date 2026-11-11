import type { ProductId } from '@/domain/types';

export type SeasonalGroup = 'fruits' | 'legumes' | 'herbes' | 'fruits_a_coque' | 'mer' | 'fromage';

/** One food with a season (mainland France). */
export interface SeasonalEntry {
  slug: string;
  name: string;
  group: SeasonalGroup;
  /** Months in season, 1 = January. All twelve: available year-round (imports, greenhouse). */
  months: readonly number[];
  /** Life-cycle footprint, kg CO2e per kg; null when the source has none. */
  kgCo2e: number | null;
}

/** Something already on the list (to buy or in the cart). */
export interface ListedFood {
  /** GroceryItem key, so a swap can name the row it replaces. */
  ref: string;
  name: string;
  slug: string | null;
  /** In the cart: taken, but not swapped. */
  checked: boolean;
}

/** A household product recognised as a seasonal food. */
export interface KnownFood {
  productId: ProductId;
  slug: string;
  inStock: boolean;
  /** Last purchase (restock), null if never bought. */
  lastBoughtAt: number | null;
}

/**
 * - `swap`: in season now, instead of a listed food that is out of season (or a year-round import).
 * - `back`: the household bought it before and its season is back.
 * - `starting`: its season starts this month.
 */
export type SeasonalReason = 'swap' | 'back' | 'starting';

export interface SeasonalSuggestion {
  slug: string;
  name: string;
  reason: SeasonalReason;
  /** For a swap: the listed row it replaces and why that one is not in season. */
  replaces: { ref: string; name: string; why: 'out-of-season' | 'imported' } | null;
  /** A household product of this food, linked when added; null adds a free-text row. */
  productId: ProductId | null;
}
