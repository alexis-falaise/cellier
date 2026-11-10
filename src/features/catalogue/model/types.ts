/**
 * Catalogue types. Mirrors sections 2, 5 and 6 of docs/architecture/contracts/catalogue.ts
 * (05-catalogue.md §2, §6, §8, §9).
 */
import type { CategoryKey, Gtin, IsoDate, IsoDateTime, NetUnit, ProductId } from '@/domain/types';

export type CatalogSource = 'off' | 'obf' | 'opf' | 'opff' | 'manual';
export type PriceChain = 'leclerc' | 'carrefour' | 'other';
export type StoreTag = 'leclerc' | 'carrefour';

/** One catalogue row, camelCase (mirror of public.catalog_products). */
export interface CatalogProduct {
  gtin: Gtin;
  name: string;
  brand: string | null;
  quantityLabel: string | null;
  /** Content of ONE element in `netUnit`. */
  netQuantity: number | null;
  netUnit: NetUnit | null;
  /** Elements per pack. Total content = netQuantity × packCount. */
  packCount: number | null;
  categoryKey: CategoryKey | null;
  categoryRule: string | null;
  imageUrl: string | null;
  source: CatalogSource;
  storeTags: StoreTag[];
  popularity: number;
  /** Most recent plausible price of one pack, euro cents. */
  priceCents: number | null;
  priceObservedOn: IsoDate | null;
  priceChain: PriceChain | null;
  sourceModifiedAt: IsoDateTime | null;
}

/** The same row as PostgREST returns it (snake_case). */
export interface CatalogProductRow {
  gtin: string;
  name: string;
  brand: string | null;
  quantity_label: string | null;
  net_quantity: number | string | null;
  net_unit: NetUnit | null;
  pack_count: number | null;
  category_key: string | null;
  category_rule: string | null;
  image_url: string | null;
  source: CatalogSource;
  store_tags: string[] | null;
  popularity: number | null;
  price_cents: number | null;
  price_observed_on: string | null;
  price_chain: PriceChain | null;
  search_text?: string;
  source_modified_at: string | null;
}

export const CATALOG_SELECT_COLUMNS =
  'gtin,name,brand,quantity_label,net_quantity,net_unit,pack_count,category_key,category_rule,' +
  'image_url,source,store_tags,popularity,price_cents,price_observed_on,price_chain,source_modified_at';

/** A catalogue price older than this is not shown and not copied into a household product. */
export const PRICE_DISPLAY_MAX_AGE_DAYS = 365;

/** Body of the `catalog-lookup` Edge Function. */
export interface CatalogLookupRequest {
  /** Canonical 14-digit GTIN. */
  gtin: string;
}

export type CatalogLookupDraft = Partial<
  Pick<CatalogProduct, 'brand' | 'quantityLabel' | 'netQuantity' | 'netUnit' | 'packCount' | 'categoryKey' | 'imageUrl'>
> | null;

export type CatalogLookupErrorCode =
  | 'invalid_request'
  | 'invalid_gtin'
  | 'restricted_gtin'
  | 'method_not_allowed'
  | 'payload_too_large'
  | 'rate_limited'
  | 'upstream_unavailable'
  | 'upstream_invalid'
  | 'internal';

export type CatalogLookupResponse =
  | { outcome: 'found'; origin: 'catalogue' | 'open_food_facts'; product: CatalogProduct; persisted: boolean }
  | { outcome: 'not_found'; cached: boolean; draft: CatalogLookupDraft }
  | { outcome: 'error'; code: CatalogLookupErrorCode; retryAfter?: number; message: string };

/** Timeouts of 05 §6.2, §8.1 and §9. */
export const CATALOGUE_TIMEOUTS = {
  /** `catalog_products` select by GTIN. */
  selectMs: 4000,
  /** `catalog-lookup` invoke. */
  functionMs: 9000,
  /** `search_catalog` RPC. */
  searchMs: 4000,
} as const;

export const CATALOGUE_SEARCH = {
  minChars: 3,
  debounceMs: 200,
  limit: 20,
  timeoutMs: 4000,
} as const;

/**
 * Every result the scan lookup can produce (contract `ScanOutcome`). `found_catalogue.via` is
 * 'device_cache' when the local lookup function answered from the device cache.
 */
export type ScanOutcome =
  | { kind: 'found_household'; gtin: Gtin; productId: ProductId; restoredFromTombstone: boolean }
  | { kind: 'found_catalogue'; gtin: Gtin; product: CatalogProduct; via: 'device_cache' | 'database' }
  | { kind: 'found_online'; gtin: Gtin; product: CatalogProduct }
  | { kind: 'not_found'; gtin: Gtin; draft: CatalogLookupDraft }
  | { kind: 'variable_measure'; raw: string }
  | { kind: 'invalid_checksum'; raw: string }
  | { kind: 'invalid_format'; raw: string }
  /** Offline and not known locally: manual entry; nothing is queued by this module. */
  | { kind: 'offline'; gtin: Gtin }
  /** Online but the lookup failed (429, 5xx, timeout, auth): manual entry now, retry offered. */
  | { kind: 'lookup_unavailable'; gtin: Gtin; retryAfter: number | null };
