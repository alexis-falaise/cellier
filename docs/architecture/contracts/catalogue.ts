/**
 * Cellier — product catalogue contract (barcode parsing, catalogue rows, the `catalog-lookup`
 * Edge Function, the category-rules artefact, the seed record).
 *
 * Companion of docs/architecture/05-catalogue.md. Every type here is described there; section
 * numbers in comments point to that document.
 *
 * Where the code lives:
 * - GTIN parsing: supabase/functions/_shared/catalogue/gtin.ts (canonical implementation),
 *   re-exported by src/domain/gtin.ts for the client (section 3).
 * - Normalisation, quantity parsing, category mapping, price selection:
 *   supabase/functions/_shared/catalogue/*.ts, dependency-free TypeScript, imported by the Edge
 *   Function (Deno) and by scripts/catalogue/*.ts (Node 24 via tsx).
 *
 * Conventions: camelCase on every wire this file defines (Edge Function JSON, client store).
 * PostgREST rows are snake_case (`CatalogProductRow`) and are converted once by
 * `toCatalogProduct` in _shared/catalogue/row.ts.
 */

import type { CategoryKey, Gtin, IsoDate, IsoDateTime, NetUnit } from './domain';

// ---------------------------------------------------------------------------------------------
// 1. Barcode parsing (section 3)
// ---------------------------------------------------------------------------------------------

/**
 * Symbology reported by the scanner (zxing-wasm `format`, mapped to these names by the scanner
 * worker). `manual` = digits typed by the user. The format matters only for UPC-E, whose
 * 8 digits are otherwise indistinguishable from an EAN-8.
 */
export type BarcodeSymbology = 'ean_13' | 'ean_8' | 'upc_a' | 'upc_e' | 'manual';

/** What the scanner hands over to the lookup flow. */
export interface ScannedCode {
  /** Raw decoded text, digits only for the four supported symbologies. */
  text: string;
  symbology: BarcodeSymbology;
  /** `performance.now()`-free wall clock, ms since epoch. */
  scannedAt: number;
}

/** Why a code is not looked up anywhere. */
export type GtinRejection =
  /** Not 8, 12, 13 or 14 digits, or contains non-digits, or an impossible UPC-E. */
  | 'invalid_format'
  /** Mod-10 check digit does not match: almost always a misread. */
  | 'invalid_checksum'
  /**
   * Restricted circulation number (in-store, variable measure). Binding rule: EAN-13 prefix 02
   * and 20-29. Proposed extension awaiting the architecture owner (section 3.4): EAN-13 prefix 04
   * (RCN-12/13, company-internal) and EAN-8 starting with 0 or 2 (RCN-8). Gated by
   * `GTIN_RESTRICTED_EXTENSION_ENABLED`.
   */
  | 'restricted_circulation';

export type GtinParseResult =
  | {
      ok: true;
      /** Canonical 14-digit key, used everywhere in Cellier. */
      gtin: Gtin;
      /** Form of the code before padding: 8, 12, 13 or 14 digits (UPC-E already expanded to 12). */
      sourceLength: 8 | 12 | 13 | 14;
      /**
       * Code to send to Open Food Facts: the GTIN with leading zeros removed, then padded to 8
       * digits if 8 or fewer remain, else to 13 digits (14 if the indicator digit is not 0).
       * This matches the server-side normalisation; sending the 14-digit form also works
       * (verified live 2026-11-10, it answers `success_with_warnings`).
       */
      offCode: string;
    }
  | {
      ok: false;
      reason: GtinRejection;
      /** Digits as received (trimmed), for display and for the manual-entry form. */
      raw: string;
      /** For `restricted_circulation`: the 13-digit form, kept only on the device, never cached. */
      restrictedEan13?: string;
    };

/** Signature of the single entry point (implemented in _shared/catalogue/gtin.ts). */
export type ParseGtin = (code: ScannedCode | string) => GtinParseResult;

/** Proposed extension of the restricted ranges (section 3.4). false until the owner approves. */
export const GTIN_RESTRICTED_EXTENSION_ENABLED = false;

// ---------------------------------------------------------------------------------------------
// 2. Catalogue product (mirror of public.catalog_products, section 2)
// ---------------------------------------------------------------------------------------------

export type CatalogSource = 'off' | 'obf' | 'opf' | 'opff' | 'manual';
export type PriceChain = 'leclerc' | 'carrefour' | 'other';
/** Values allowed in `store_tags` (ranking signal only). */
export type StoreTag = 'leclerc' | 'carrefour';

/**
 * Category mapping trace stored in `category_rule` (max 120 characters):
 * - `tier0:<tag>`, `tier1:<tag>`, `tier2:<tag>`: the rule tag that matched (it may be an
 *   ancestor of the product tag), e.g. `tier2:en:wines`.
 * - `fg:<food group tag>`: food-group fallback, e.g. `fg:en:sweets`.
 * - `pnns2:<value>` / `pnns1:<value>`: only when food groups are absent (live path).
 * - `name:<regex index>`: product-name regular expression, e.g. `name:0`.
 * - `db:<source>`: database default, e.g. `db:obf`.
 * - `fallback`: nothing matched, `category_key` = 'autre'.
 * Every trace is prefixed with the rules version: `v3|tier2:en:wines` (section 5.6).
 */
export type CategoryRuleTrace = string;

/** One catalogue row, camelCase. Field for field the columns of public.catalog_products. */
export interface CatalogProduct {
  gtin: Gtin;
  /** 1-200 characters, French name preferred. */
  name: string;
  /** First brand only, max 120 characters. */
  brand: string | null;
  /** Quantity as printed on the pack (Open Food Facts `quantity`), max 60 characters. */
  quantityLabel: string | null;
  /** Content of ONE element in `netUnit` (> 0, 3 decimals). */
  netQuantity: number | null;
  netUnit: NetUnit | null;
  /** Elements per pack, 1-999. Total content = netQuantity x packCount. */
  packCount: number | null;
  /** Default category slug, or null if the mapped slug no longer exists. */
  categoryKey: CategoryKey | null;
  categoryRule: CategoryRuleTrace | null;
  /** Front image, 200 px, on the images host of the source database. Max 500 characters. */
  imageUrl: string | null;
  source: CatalogSource;
  storeTags: StoreTag[];
  /** Open Food Facts `unique_scans_n` (0 when unknown). */
  popularity: number;
  /** Most recent plausible price of one pack, euro cents (section 7). */
  priceCents: number | null;
  priceObservedOn: IsoDate | null;
  priceChain: PriceChain | null;
  /** Generated column (normalised name + brand). Present in rows read back, never written. */
  searchText?: string;
  /** Open Food Facts `last_modified_t` as a timestamp. */
  sourceModifiedAt: IsoDateTime | null;
  createdAt?: IsoDateTime;
  updatedAt?: IsoDateTime;
}

/** The same row as PostgREST returns it (snake_case). Converted by `toCatalogProduct`. */
export interface CatalogProductRow {
  gtin: string;
  name: string;
  brand: string | null;
  quantity_label: string | null;
  net_quantity: number | null;
  net_unit: NetUnit | null;
  pack_count: number | null;
  category_key: string | null;
  category_rule: string | null;
  image_url: string | null;
  source: CatalogSource;
  store_tags: string[];
  popularity: number;
  price_cents: number | null;
  price_observed_on: string | null;
  price_chain: PriceChain | null;
  search_text?: string;
  source_modified_at: string | null;
  created_at?: string;
  updated_at?: string;
}

/** Column list used by the client select (step 3 of the lookup chain) and by search results. */
export const CATALOG_SELECT_COLUMNS =
  'gtin,name,brand,quantity_label,net_quantity,net_unit,pack_count,category_key,category_rule,' +
  'image_url,source,store_tags,popularity,price_cents,price_observed_on,price_chain,source_modified_at';

/** A catalogue price older than this is not shown and not copied into a household product. */
export const PRICE_DISPLAY_MAX_AGE_DAYS = 365;
/** Prices older than this are not ingested, and are cleared from rows by the monthly refresh. */
export const PRICE_INGEST_MAX_AGE_DAYS = 548; // about 18 months

// ---------------------------------------------------------------------------------------------
// 3. Quantity parsing (section 4)
// ---------------------------------------------------------------------------------------------

export interface QuantityInput {
  /** Open Food Facts `quantity` (free text). */
  quantity?: string | null;
  /** Open Food Facts `product_quantity` (number on the API, string in the Parquet dump). */
  productQuantity?: number | string | null;
  /** Open Food Facts `product_quantity_unit` ('g', 'ml', sometimes others). */
  productQuantityUnit?: string | null;
}

export interface QuantityParse {
  quantityLabel: string | null;
  netQuantity: number | null;
  netUnit: NetUnit | null;
  packCount: number | null;
  /** How the values were obtained; logged in seed reports, not stored. */
  method: 'label_multipack' | 'label_single' | 'label_count' | 'product_quantity' | 'none';
}

// ---------------------------------------------------------------------------------------------
// 4. Category mapping (section 5)
// ---------------------------------------------------------------------------------------------

/** Input of `mapCategory`, identical on the live path and the seed path. */
export interface CategoryMappingInput {
  source: Exclude<CatalogSource, 'manual'>;
  /** `categories_tags` (contains the ancestors already; unknown tags may be free text). */
  categoriesTags: string[];
  /** `food_groups_tags` (present in the Parquet dump and on the API). */
  foodGroupsTags: string[];
  /** Live path only (absent from the Parquet dump); used only when foodGroupsTags is empty. */
  pnnsGroups1?: string | null;
  pnnsGroups2?: string | null;
  /** Normalised display name (after name selection). */
  name: string;
}

export interface CategoryMappingResult {
  categoryKey: CategoryKey;
  categoryRule: CategoryRuleTrace;
}

/**
 * Format of supabase/functions/_shared/catalogue/category-rules.json, generated by
 * scripts/catalogue/build-category-rules.ts from scripts/catalogue/category-rules.source.json
 * and the four taxonomy files. Never edited by hand.
 */
export interface CategoryRulesArtefact {
  /** Format of this file. Bump only when the shape changes (code must be updated too). */
  format: 1;
  /** Rules version, a positive integer incremented on every content change. */
  version: number;
  /** When the artefact was built (ISO timestamp). */
  builtAt: IsoDateTime;
  /** Taxonomy inputs, so a build is reproducible and a diff is explainable. */
  taxonomies: Record<
    'food' | 'beauty' | 'products' | 'petfood' | 'food_groups',
    { url: string; sha256: string; lastModified: string | null; entries: number }
  >;
  /** The 28 slugs, in the order of category_templates.sort_order. Checked against the SQL seed. */
  categories: CategoryKey[];
  /** Tag rules, inverted to tag -> category for O(1) lookup. A tag appears in one tier at most. */
  tagRules: {
    tier0: Record<string, CategoryKey>;
    tier1: Record<string, CategoryKey>;
    tier2: Record<string, CategoryKey>;
  };
  /**
   * Pruned ancestor map: for every taxonomy tag that is a rule tag or has a rule tag among its
   * ancestors, the rule-carrying ancestors ordered nearest first (breadth-first distance, then
   * alphabetical). Tags with no rule-carrying ancestor are omitted.
   */
  ancestors: Record<string, string[]>;
  /** Depth (longest path to a root) of every tag kept in `ancestors` or `tagRules`. */
  depth: Record<string, number>;
  /**
   * Tag canonicalisation: slugified French and English taxonomy names -> canonical tag, pruned
   * to tags present in `ancestors` or `tagRules`. Key form: `<lang>:<slug>`, e.g.
   * `fr:liquide-vaisselle` -> `fr:liquide-vaisselle`, `en:dish-detergents` -> `en:dish-detergent-soap`.
   */
  synonyms: Record<string, string>;
  /** Tags ignored entirely (noise), e.g. `en:incorrect-product-type`, `en:non-food-products`. */
  ignoredTags: string[];
  /** Food-group fallback (`food_groups_tags`, level 2 then level 1). */
  foodGroups: Record<string, CategoryKey>;
  /** pnns fallbacks, live path only (exact strings as returned by the API). */
  pnns2: Record<string, CategoryKey>;
  pnns1: Record<string, CategoryKey>;
  /** Name regular expressions, tried in order; flags are always 'iu'. Trace `name:<index>`. */
  nameRegexes: Array<{ pattern: string; categoryKey: CategoryKey }>;
  /** Default per source database when nothing else matched. */
  databaseDefaults: Partial<Record<Exclude<CatalogSource, 'manual'>, CategoryKey>>;
  finalFallback: 'autre';
}

/**
 * Human-edited source of the rules (scripts/catalogue/category-rules.source.json): the research/06
 * table, category -> tags. The build script inverts it, checks every tag against the taxonomies
 * and fails on unknown tags, duplicate tags and unknown category keys.
 */
export interface CategoryRulesSource {
  version: number;
  tier0: Partial<Record<CategoryKey, string[]>>;
  tier1: Partial<Record<CategoryKey, string[]>>;
  tier2: Partial<Record<CategoryKey, string[]>>;
  foodGroups: Record<string, CategoryKey>;
  pnns2: Record<string, CategoryKey>;
  pnns1: Record<string, CategoryKey>;
  nameRegexes: Array<[pattern: string, categoryKey: CategoryKey]>;
  databaseDefaults: Partial<Record<Exclude<CatalogSource, 'manual'>, CategoryKey>>;
  ignoredTags: string[];
}

// ---------------------------------------------------------------------------------------------
// 5. Edge Function `catalog-lookup` (section 6)
// ---------------------------------------------------------------------------------------------

/**
 * POST {SUPABASE_URL}/functions/v1/catalog-lookup
 * Headers: Authorization: Bearer <user access token>, apikey: <publishable key>,
 *          Content-Type: application/json. Body at most 1 KiB.
 */
export interface CatalogLookupRequest {
  /** Canonical 14-digit GTIN (the server re-validates it with the same parser). */
  gtin: string;
}

/** Where the returned row came from. */
export type CatalogLookupOrigin =
  /** Already in public.catalog_products (another user created it moments ago). */
  | 'catalogue'
  /** Fetched from the Open Food Facts family now, normalised and stored. */
  | 'open_food_facts';

/** HTTP 200. */
export interface CatalogLookupFound {
  outcome: 'found';
  origin: CatalogLookupOrigin;
  product: CatalogProduct;
  /** false when the row could not be stored (catalogue cap reached or database error). */
  persisted: boolean;
}

/** HTTP 200. Absent from all four databases, or present without a usable name. */
export interface CatalogLookupNotFound {
  outcome: 'not_found';
  /** true when the answer came from the negative cache (no upstream call was made). */
  cached: boolean;
  /**
   * Partial data to pre-fill the manual form when the product exists upstream without a name
   * (brand, quantity, category guess). Never stored in the catalogue.
   */
  draft: Partial<Pick<CatalogProduct, 'brand' | 'quantityLabel' | 'netQuantity' | 'netUnit' | 'packCount' | 'categoryKey' | 'imageUrl'>> | null;
}

export type CatalogLookupErrorCode =
  | 'invalid_request' // 400: body is not JSON, or no `gtin` string
  | 'invalid_gtin' // 400: format or checksum
  | 'restricted_gtin' // 400: in-store / variable-measure code
  | 'method_not_allowed' // 405
  | 'payload_too_large' // 413
  | 'rate_limited' // 429: per-user limit (Retry-After set)
  | 'upstream_unavailable' // 503: Open Food Facts down, 503/429, or timeout (Retry-After set)
  | 'upstream_invalid' // 502: Open Food Facts answered something unparseable
  | 'internal'; // 500

/** Body of every non-200 answer produced by the function itself (401 comes from the gateway). */
export interface CatalogLookupError {
  outcome: 'error';
  code: CatalogLookupErrorCode;
  /** Seconds; mirrors the Retry-After header for 429 and 503. */
  retryAfter?: number;
  /** English, for logs only; the UI maps `code` to French strings in fr.ts. */
  message: string;
}

export type CatalogLookupResponse = CatalogLookupFound | CatalogLookupNotFound | CatalogLookupError;

/** Limits enforced by the function (section 6.6). */
export const CATALOG_LOOKUP_LIMITS = {
  maxBodyBytes: 1024,
  /** Whole-request budget inside the function. */
  totalBudgetMs: 7000,
  /** Open Food Facts product call, redirect included. */
  upstreamTimeoutMs: 4500,
  /** Second host tried only if the first failed and this much budget remains. */
  fallbackMinBudgetMs: 2500,
  /** Open Prices call, run in parallel, never blocks the answer beyond this. */
  priceTimeoutMs: 2500,
  /** Client-side timeout of the invoke call. */
  clientTimeoutMs: 9000,
  perUserPer10Min: 40,
  perUserPerDay: 300,
  /** Upstream product calls per minute across all users (Open Food Facts allows 15 per IP). */
  globalUpstreamPerMinute: 10,
  /** Negative cache lifetime for "not found anywhere". */
  missTtlHours: 72,
  /** Soft cap: above this row estimate, new rows are returned but not stored. */
  catalogueRowCap: 200_000,
} as const;

// ---------------------------------------------------------------------------------------------
// 6. Client lookup chain and scanner outcomes (section 8)
// ---------------------------------------------------------------------------------------------

/** Entry of the per-device IndexedDB cache (`catalogue-cache` store, key `gtin`). */
export interface CatalogueCacheEntry {
  gtin: Gtin;
  product: CatalogProduct;
  /** When the row was fetched from the server. Older than 30 days = revalidate in background. */
  fetchedAt: number;
  /** Indexed; least recently used eviction above 2,000 entries. */
  lastUsedAt: number;
}

export const CATALOGUE_CACHE_MAX_ENTRIES = 2000;
export const CATALOGUE_CACHE_REVALIDATE_DAYS = 30;

/** Every result the scan flow can produce; the scanner UI must render each one. */
export type ScanOutcome =
  | { kind: 'found_household'; gtin: Gtin; productId: string; restoredFromTombstone: boolean }
  | { kind: 'found_catalogue'; gtin: Gtin; product: CatalogProduct; via: 'device_cache' | 'database' }
  | { kind: 'found_online'; gtin: Gtin; product: CatalogProduct }
  | { kind: 'not_found'; gtin: Gtin; draft: CatalogLookupNotFound['draft'] }
  | { kind: 'variable_measure'; raw: string }
  | { kind: 'invalid_checksum'; raw: string }
  | { kind: 'invalid_format'; raw: string }
  /** Offline and not in the household or the device cache: manual entry, lookup queued. */
  | { kind: 'offline'; gtin: Gtin }
  /** Online but the lookup failed (429, 503, timeout): manual entry now, retry offered. */
  | { kind: 'lookup_unavailable'; gtin: Gtin; retryAfter: number | null };

/** Manual add search (section 9). */
export const CATALOGUE_SEARCH = {
  minChars: 3,
  debounceMs: 200,
  limit: 20,
  timeoutMs: 4000,
} as const;

// ---------------------------------------------------------------------------------------------
// 7. Seed record (section 10)
// ---------------------------------------------------------------------------------------------

/**
 * One line of the staging CSV loaded with `\copy` (header row, UTF-8, comma, RFC 4180 quoting,
 * empty field = NULL). Column order is SEED_CSV_COLUMNS. Every value is already normalised by
 * the shared code: the load SQL does no transformation besides casts.
 */
export interface SeedRecord {
  gtin: string; // 14 digits, valid check digit, not restricted
  name: string;
  brand: string | null;
  quantity_label: string | null;
  net_quantity: string | null; // decimal with '.' and at most 3 decimals
  net_unit: NetUnit | null;
  pack_count: number | null;
  category_key: CategoryKey; // never null in the seed ('autre' at worst)
  category_rule: CategoryRuleTrace;
  image_url: string | null;
  source: Exclude<CatalogSource, 'manual'>;
  store_tags: string; // Postgres array literal: '{}' | '{leclerc}' | '{carrefour}' | '{leclerc,carrefour}'
  popularity: number;
  price_cents: number | null;
  price_observed_on: IsoDate | null;
  price_chain: PriceChain | null;
  source_modified_at: IsoDateTime | null; // ISO 8601 UTC
}

export const SEED_CSV_COLUMNS = [
  'gtin', 'name', 'brand', 'quantity_label', 'net_quantity', 'net_unit', 'pack_count',
  'category_key', 'category_rule', 'image_url', 'source', 'store_tags', 'popularity',
  'price_cents', 'price_observed_on', 'price_chain', 'source_modified_at',
] as const satisfies ReadonlyArray<keyof SeedRecord>;

/** One line of the price CSV produced by scripts/catalogue/refresh-prices.ts (section 7). */
export interface PriceRecord {
  gtin: string;
  price_cents: number;
  price_observed_on: IsoDate;
  price_chain: PriceChain;
  /** Number of plausible observations behind the choice (report only, not loaded). */
  sample_size: number;
}

/** Seed selection limits (section 10.2). */
export const SEED_LIMITS = {
  targetRows: 130_000,
  minRows: 100_000,
  /** Hard cap on seed rows; the build fails above it. */
  maxRows: 150_000,
  /** Hard cap on pg_total_relation_size('public.catalog_products'), bytes. */
  maxTableBytes: 150 * 1024 * 1024,
  /** The load aborts if the whole database is already above this, bytes. */
  maxDatabaseBytesBeforeLoad: 380 * 1024 * 1024,
  nonFoodMaxRows: 30_000,
} as const;
