/** snake_case catalogue rows <-> camelCase CatalogProduct, and parsing of the gate answer. */
import { CATEGORY_KEYS, type CatalogProduct, type CatalogProductRow, type CategoryKey, type GateDecision, type StoreTag } from './types.ts';

const isCategoryKey = (v: unknown): v is CategoryKey => typeof v === 'string' && (CATEGORY_KEYS as readonly string[]).includes(v);

export function toCatalogProduct(row: CatalogProductRow): CatalogProduct {
  const nq = row.net_quantity === null || row.net_quantity === undefined ? null : Number(row.net_quantity);
  return {
    gtin: row.gtin,
    name: row.name,
    brand: row.brand ?? null,
    quantityLabel: row.quantity_label ?? null,
    netQuantity: nq !== null && Number.isFinite(nq) ? nq : null,
    netUnit: row.net_unit ?? null,
    packCount: row.pack_count ?? null,
    categoryKey: isCategoryKey(row.category_key) ? row.category_key : null,
    categoryRule: row.category_rule ?? null,
    imageUrl: row.image_url ?? null,
    source: row.source,
    storeTags: (row.store_tags ?? []).filter((t): t is StoreTag => t === 'leclerc' || t === 'carrefour'),
    popularity: row.popularity ?? 0,
    priceCents: row.price_cents ?? null,
    priceObservedOn: row.price_observed_on ?? null,
    priceChain: row.price_chain ?? null,
    sourceModifiedAt: row.source_modified_at ?? null,
    ...(row.created_at ? { createdAt: row.created_at } : {}),
    ...(row.updated_at ? { updatedAt: row.updated_at } : {}),
  };
}

/** p_row for public.catalog_upsert (snake_case columns; search_text and timestamps omitted). */
export function toUpsertRow(p: CatalogProduct, categoryTags: string[]): Record<string, unknown> {
  return {
    gtin: p.gtin,
    name: p.name,
    brand: p.brand,
    quantity_label: p.quantityLabel,
    net_quantity: p.netQuantity,
    net_unit: p.netUnit,
    pack_count: p.packCount,
    category_key: p.categoryKey,
    category_rule: p.categoryRule,
    category_tags: categoryTags,
    image_url: p.imageUrl,
    source: p.source,
    store_tags: p.storeTags,
    popularity: p.popularity,
    price_cents: p.priceCents,
    price_observed_on: p.priceObservedOn,
    price_chain: p.priceChain,
    source_modified_at: p.sourceModifiedAt,
  };
}

/** Validates the jsonb returned by public.catalog_lookup_gate; null if malformed. */
export function parseGate(v: unknown): GateDecision | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const retry = typeof o.retryAfter === 'number' && o.retryAfter > 0 ? Math.ceil(o.retryAfter) : 60;
  switch (o.decision) {
    case 'admit':
      return { decision: 'admit', catalogueFull: o.catalogueFull === true };
    case 'cached_miss':
      return { decision: 'cached_miss' };
    case 'rate_limited':
      return { decision: 'rate_limited', retryAfter: retry };
    case 'upstream_budget_exhausted':
      return { decision: 'upstream_budget_exhausted', retryAfter: retry };
    default:
      return null;
  }
}
