/**
 * Product text shared by the Stock list, item detail and the edit sheets (design 03 §3.3, §4.6):
 * size («500 g», «6 × 1 L»), the «{brand} · {size}» line, the per-cellier split of «Tous les
 * celliers», the row's accessible name and barcode display.
 */
import type { Pantry, Product } from '@/domain/types';
import { formatQuantity, type MessageKey, type MessageParams, t } from '@/shared/i18n';

type SizeFields = Pick<Product, 'netQuantity' | 'netUnit' | 'packCount'>;

/** «500 g», «75 cl», «6 pièces», «6 × 1 L»; null when the product has no size. */
export function productSize(product: SizeFields): string | null {
  if (product.netQuantity === null || product.netUnit === null || !(product.netQuantity > 0)) return null;
  const size = formatQuantity(product.netQuantity, product.netUnit);
  return product.packCount !== null && product.packCount > 1
    ? t('item.size.pack', { n: product.packCount, size })
    : size;
}

/** «{brand} · {size}», or whichever exists; null when neither does. */
export function brandSizeLine(product: Pick<Product, 'brand'> & SizeFields): string | null {
  const brand = product.brand?.trim() || null;
  const size = productSize(product);
  if (brand && size) return t('item.row.brandSize', { brand, size });
  return brand ?? size;
}

/** Products created from an unknown barcode and never named (design «À compléter»). */
export function isIncomplete(product: Pick<Product, 'name'>): boolean {
  return product.name.trim() === '' || product.name === t('scanner.unknown.unnamed');
}

/**
 * «Cave 3 · Cuisine 1», «+2» beyond two celliers (03 §3.3, «Tous les celliers» mode).
 * `perPantry` is in household pantry order; rows of unknown pantries are skipped.
 */
export function pantrySplitLine(
  perPantry: ReadonlyArray<{ pantryId: string; quantity: number }>,
  pantryNames: ReadonlyMap<string, string>,
): string | null {
  const rows = perPantry.filter((r) => pantryNames.has(r.pantryId));
  const [a, b] = rows;
  if (!a) return null;
  const nameA = pantryNames.get(a.pantryId) ?? '';
  if (!b) return t('item.row.splitOne', { pantry: nameA, qty: a.quantity });
  const split = t('item.row.split', {
    pantryA: nameA,
    qtyA: a.quantity,
    pantryB: pantryNames.get(b.pantryId) ?? '',
    qtyB: b.quantity,
  });
  return rows.length > 2 ? `${split} ${t('item.row.splitMore', { n: rows.length - 2 })}` : split;
}

/** «{name}, {details}, {quantity} en stock[, bientôt épuisé]» (03 §3.3). */
export function itemRowLabel(name: string, details: string | null, quantity: number, low: boolean): string {
  const label = details ? t('a11y.item.row', { name, details, quantity }) : t('a11y.item.rowShort', { name, quantity });
  return low ? `${label}${t('a11y.item.lowSuffix')}` : label;
}

/** Barcode digits as printed on the pack: EAN-13 for GTIN-14 values with a leading zero. */
export function displayBarcode(gtin: string): string {
  return gtin.length === 14 && gtin.startsWith('0') ? gtin.slice(1) : gtin;
}

/** Name lookup of live pantries. */
export function pantryNameMap(pantries: readonly Pantry[]): Map<string, string> {
  return new Map(pantries.map((p) => [p.id as string, p.name]));
}

/** Catalogue keys without placeholders: `t(key)` with a key chosen at runtime. */
export type PlainMessageKey = {
  [K in MessageKey]: keyof MessageParams<K> extends never ? K : never;
}[MessageKey];
