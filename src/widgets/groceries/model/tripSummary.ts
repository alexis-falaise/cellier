import type { ProductView } from '@/domain/types';
import type { GroceryItem } from '@/features/forecast';
import { type CategoryVisual, categoryVisual } from '@/shared/ui/categories';
import { itemName, tripPreview } from './presentation';

const GENERIC = categoryVisual({});

/** Category look of a Courses row: the product's category, else the generic tile. */
export function itemVisual(item: GroceryItem, viewsById: ReadonlyMap<string, ProductView>): CategoryVisual {
  if (item.kind !== 'product') return GENERIC;
  const category = viewsById.get(item.productId)?.category;
  return category ? categoryVisual(category) : GENERIC;
}

/** NextTripCard summary row (03 §4.2.4): count, up to 4 distinct category tiles, three most urgent names. */
export function tripSummary(items: readonly GroceryItem[], viewsById: ReadonlyMap<string, ProductView>) {
  if (items.length === 0) return null;
  const visuals: CategoryVisual[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const v = itemVisual(item, viewsById);
    const key = `${v.iconName}:${v.hue}`;
    if (seen.has(key)) continue;
    seen.add(key);
    visuals.push(v);
    if (visuals.length === 4) break;
  }
  return { count: items.length, visuals, preview: tripPreview(items.map(itemName)) };
}
