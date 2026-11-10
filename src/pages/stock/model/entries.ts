/**
 * Builds the Stock list items of the current scope from the store views. An item keeps its object
 * while nothing it shows changed, so unchanged rows do not re-render.
 */
import type { ProductView } from '@/domain/types';
import type { PantryStockItem } from '@/entities/pantry';
import type { ProductForecast } from '@/features/forecast';
import { t } from '@/shared/i18n';
import { type CategoryVisual, categoryVisual } from '@/shared/ui';
import { isRunningLow } from '@/widgets/item/forecasts';
import { brandSizeLine, isIncomplete, itemRowLabel, pantrySplitLine } from '@/widgets/item/productText';
import type { StockItem } from './stockList';

export interface StockEntry extends StockItem {
  view: ProductView;
  secondary: string | null;
  accessibleLabel: string;
  visual: CategoryVisual;
  /** Cellier the swipes act on, and its quantity (the −1 clamp). */
  targetPantryId: string | null;
  targetQuantity: number;
}

export type EntryCache = Map<string, StockEntry>;

const visuals = new WeakMap<object, CategoryVisual>();
const genericVisual = categoryVisual({});

function visualOf(view: ProductView): CategoryVisual {
  const category = view.category;
  if (!category) return genericVisual;
  let v = visuals.get(category);
  if (!v) {
    v = categoryVisual(category);
    visuals.set(category, v);
  }
  return v;
}

interface Scoped {
  view: ProductView;
  quantity: number;
  targetPantryId: string | null;
  targetQuantity: number;
  secondary: string | null;
}

/** The cellier holding the most of a product (first in order on a tie). */
function fullestPantry(view: ProductView): { pantryId: string; quantity: number } | null {
  let best: { pantryId: string; quantity: number } | null = null;
  for (const row of view.perPantry) if (!best || row.quantity > best.quantity) best = row;
  return best;
}

export interface EntryScope {
  /** «Tous les celliers». */
  all: boolean;
  /** Current cellier (one-cellier scope) or the fallback target for products stocked nowhere. */
  pantryId: string | null;
  pantryNames: ReadonlyMap<string, string>;
}

export function buildStockEntries(
  scope: EntryScope,
  views: readonly ProductView[],
  pantryStock: readonly PantryStockItem[],
  forecasts: ReadonlyMap<string, ProductForecast>,
  cache: EntryCache,
): { entries: StockEntry[]; cache: EntryCache } {
  const scoped: Scoped[] = scope.all
    ? views.map((view) => {
        const target = fullestPantry(view);
        return {
          view,
          quantity: view.totalQuantity,
          targetPantryId: target?.pantryId ?? scope.pantryId,
          targetQuantity: target?.quantity ?? 0,
          secondary: pantrySplitLine(view.perPantry, scope.pantryNames),
        };
      })
    : pantryStock.map(({ view, quantity }) => ({
        view,
        quantity,
        targetPantryId: scope.pantryId,
        targetQuantity: quantity,
        secondary: null,
      }));

  const next: EntryCache = new Map();
  const entries = scoped.map(({ view, quantity, targetPantryId, targetQuantity, secondary: split }) => {
    const product = view.product;
    const low = isRunningLow(view, forecasts.get(product.id));
    const details = brandSizeLine(product) ?? view.category?.name ?? null;
    const secondary = isIncomplete(product) ? t('item.row.incomplete') : (split ?? details);
    const prev = cache.get(product.id);
    if (
      prev &&
      prev.view === view &&
      prev.quantity === quantity &&
      prev.low === low &&
      prev.secondary === secondary &&
      prev.targetPantryId === targetPantryId &&
      prev.targetQuantity === targetQuantity
    ) {
      next.set(product.id, prev);
      return prev;
    }
    const entry: StockEntry = {
      id: product.id,
      name: product.name,
      categoryId: view.category?.id ?? null,
      categoryOrder: view.category?.sortOrder ?? Number.MAX_SAFE_INTEGER,
      categoryName: view.category?.name ?? null,
      quantity,
      priceCents: product.priceCents,
      lastAddedAt: view.lastRestockAt ? Date.parse(view.lastRestockAt) : null,
      low,
      view,
      secondary,
      accessibleLabel: itemRowLabel(product.name, details, quantity, low),
      visual: visualOf(view),
      targetPantryId,
      targetQuantity,
    };
    next.set(product.id, entry);
    return entry;
  });
  return { entries, cache: next };
}
