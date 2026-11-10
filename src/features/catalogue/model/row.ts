import { CATEGORY_KEYS, type CategoryKey, type Gtin, type NetUnit } from '@/domain/types';
import type { CatalogProduct, CatalogProductRow, CatalogSource, PriceChain, StoreTag } from './types';

const CATEGORY_SET: ReadonlySet<string> = new Set(CATEGORY_KEYS);
const NET_UNITS: ReadonlySet<string> = new Set(['g', 'ml', 'piece']);
const SOURCES: ReadonlySet<string> = new Set(['off', 'obf', 'opf', 'opff', 'manual']);
const CHAINS: ReadonlySet<string> = new Set(['leclerc', 'carrefour', 'other']);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/** True for a canonical 14-digit GTIN string. */
export const isGtin14 = (v: unknown): v is Gtin => typeof v === 'string' && /^\d{14}$/.test(v);

/**
 * snake_case PostgREST row → camelCase `CatalogProduct`. Returns null for a row without a GTIN or
 * name (defensive: the database types are not generated yet, so the row is checked at the boundary).
 */
export function toCatalogProduct(row: unknown): CatalogProduct | null {
  if (!isRecord(row)) return null;
  const r = row as Partial<Record<keyof CatalogProductRow, unknown>>;
  const gtin = str(r.gtin);
  const name = str(r.name);
  if (gtin === null || !isGtin14(gtin) || name === null) return null;
  const categoryKey = str(r.category_key);
  const netUnit = str(r.net_unit);
  const source = str(r.source);
  const chain = str(r.price_chain);
  return {
    gtin,
    name,
    brand: str(r.brand),
    quantityLabel: str(r.quantity_label),
    netQuantity: num(r.net_quantity),
    netUnit: netUnit !== null && NET_UNITS.has(netUnit) ? (netUnit as NetUnit) : null,
    packCount: num(r.pack_count),
    categoryKey: categoryKey !== null && CATEGORY_SET.has(categoryKey) ? (categoryKey as CategoryKey) : null,
    categoryRule: str(r.category_rule),
    imageUrl: str(r.image_url),
    source: source !== null && SOURCES.has(source) ? (source as CatalogSource) : 'off',
    storeTags: Array.isArray(r.store_tags)
      ? r.store_tags.filter((t): t is StoreTag => t === 'leclerc' || t === 'carrefour')
      : [],
    popularity: num(r.popularity) ?? 0,
    priceCents: num(r.price_cents),
    priceObservedOn: str(r.price_observed_on),
    priceChain: chain !== null && CHAINS.has(chain) ? (chain as PriceChain) : null,
    sourceModifiedAt: str(r.source_modified_at),
  };
}

/** Checks a camelCase product from the Edge Function (same shape as `CatalogProduct`). */
export function parseFunctionProduct(value: unknown): CatalogProduct | null {
  if (!isRecord(value)) return null;
  const v = value;
  return toCatalogProduct({
    gtin: v.gtin,
    name: v.name,
    brand: v.brand,
    quantity_label: v.quantityLabel,
    net_quantity: v.netQuantity,
    net_unit: v.netUnit,
    pack_count: v.packCount,
    category_key: v.categoryKey,
    category_rule: v.categoryRule,
    image_url: v.imageUrl,
    source: v.source,
    store_tags: v.storeTags,
    popularity: v.popularity,
    price_cents: v.priceCents,
    price_observed_on: v.priceObservedOn,
    price_chain: v.priceChain,
    source_modified_at: v.sourceModifiedAt,
  });
}
