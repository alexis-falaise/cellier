/**
 * Types copied from docs/architecture/contracts/catalogue.ts and contracts/domain.ts
 * (the function cannot import from docs/). Keep in step with the contract.
 */

export type Gtin = string;
export type IsoDate = string;
export type IsoDateTime = string;
export type NetUnit = 'g' | 'ml' | 'piece';

export const CATEGORY_KEYS = [
  'legumes', 'fruits', 'feculents', 'poisson', 'viande', 'laitier', 'pain', 'apero',
  'epicerie_sucree', 'chocolat', 'petit_dej', 'conserves', 'surgeles', 'plats', 'soft', 'jus',
  'eau', 'vin', 'biere', 'cafe', 'condiments', 'bebe', 'animaux', 'entretien', 'hygiene',
  'papier', 'pharmacie', 'autre',
] as const;
export type CategoryKey = (typeof CATEGORY_KEYS)[number];

export type CatalogSource = 'off' | 'obf' | 'opf' | 'opff' | 'manual';
export type UpstreamSource = Exclude<CatalogSource, 'manual'>;
export type PriceChain = 'leclerc' | 'carrefour' | 'other';
export type StoreTag = 'leclerc' | 'carrefour';
export type CategoryRuleTrace = string;

export interface CatalogProduct {
  gtin: Gtin;
  name: string;
  brand: string | null;
  quantityLabel: string | null;
  netQuantity: number | null;
  netUnit: NetUnit | null;
  packCount: number | null;
  categoryKey: CategoryKey | null;
  categoryRule: CategoryRuleTrace | null;
  imageUrl: string | null;
  source: CatalogSource;
  storeTags: StoreTag[];
  popularity: number;
  priceCents: number | null;
  priceObservedOn: IsoDate | null;
  priceChain: PriceChain | null;
  searchText?: string;
  sourceModifiedAt: IsoDateTime | null;
  createdAt?: IsoDateTime;
  updatedAt?: IsoDateTime;
}

export interface CatalogProductRow {
  gtin: string;
  name: string;
  brand: string | null;
  quantity_label: string | null;
  net_quantity: number | string | null; // numeric may come back as a string
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

export const CATALOG_SELECT_COLUMNS =
  'gtin,name,brand,quantity_label,net_quantity,net_unit,pack_count,category_key,category_rule,' +
  'image_url,source,store_tags,popularity,price_cents,price_observed_on,price_chain,source_modified_at';

export const PRICE_DISPLAY_MAX_AGE_DAYS = 365;
export const PRICE_INGEST_MAX_AGE_DAYS = 548;

export interface QuantityInput {
  quantity?: string | null;
  productQuantity?: number | string | null;
  productQuantityUnit?: string | null;
}

export interface QuantityParse {
  quantityLabel: string | null;
  netQuantity: number | null;
  netUnit: NetUnit | null;
  packCount: number | null;
  method: 'label_multipack' | 'label_single' | 'label_count' | 'product_quantity' | 'none';
}

export interface CategoryMappingInput {
  source: UpstreamSource;
  categoriesTags: string[];
  foodGroupsTags: string[];
  pnnsGroups1?: string | null;
  pnnsGroups2?: string | null;
  name: string;
}

export interface CategoryMappingResult {
  categoryKey: CategoryKey;
  categoryRule: CategoryRuleTrace;
}

export interface CategoryRulesArtefact {
  format: 1;
  version: number;
  builtAt: IsoDateTime;
  taxonomies: Record<
    'food' | 'beauty' | 'products' | 'petfood' | 'food_groups',
    { url: string; sha256: string; lastModified: string | null; entries: number }
  >;
  categories: CategoryKey[];
  tagRules: {
    tier0: Record<string, CategoryKey>;
    tier1: Record<string, CategoryKey>;
    tier2: Record<string, CategoryKey>;
  };
  ancestors: Record<string, string[]>;
  depth: Record<string, number>;
  synonyms: Record<string, string>;
  ignoredTags: string[];
  foodGroups: Record<string, CategoryKey>;
  pnns2: Record<string, CategoryKey>;
  pnns1: Record<string, CategoryKey>;
  nameRegexes: Array<{ pattern: string; categoryKey: CategoryKey }>;
  databaseDefaults: Partial<Record<UpstreamSource, CategoryKey>>;
  finalFallback: 'autre';
}

export interface CatalogLookupRequest {
  gtin: string;
}

export type CatalogLookupOrigin = 'catalogue' | 'open_food_facts';

export interface CatalogLookupFound {
  outcome: 'found';
  origin: CatalogLookupOrigin;
  product: CatalogProduct;
  persisted: boolean;
}

export type CatalogLookupDraft = Partial<
  Pick<CatalogProduct, 'brand' | 'quantityLabel' | 'netQuantity' | 'netUnit' | 'packCount' | 'categoryKey' | 'imageUrl'>
>;

export interface CatalogLookupNotFound {
  outcome: 'not_found';
  cached: boolean;
  draft: CatalogLookupDraft | null;
}

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

export interface CatalogLookupError {
  outcome: 'error';
  code: CatalogLookupErrorCode;
  retryAfter?: number;
  message: string;
}

export type CatalogLookupResponse = CatalogLookupFound | CatalogLookupNotFound | CatalogLookupError;

export const CATALOG_LOOKUP_LIMITS = {
  maxBodyBytes: 1024,
  totalBudgetMs: 7000,
  upstreamTimeoutMs: 4500,
  fallbackMinBudgetMs: 2500,
  priceTimeoutMs: 2500,
  clientTimeoutMs: 9000,
  perUserPer10Min: 40,
  perUserPerDay: 300,
  globalUpstreamPerMinute: 10,
  missTtlHours: 72,
  catalogueRowCap: 200_000,
} as const;

/** Answer of public.catalog_lookup_gate (migration 20261110121100). */
export type GateDecision =
  | { decision: 'admit'; catalogueFull: boolean }
  | { decision: 'cached_miss' }
  | { decision: 'rate_limited'; retryAfter: number }
  | { decision: 'upstream_budget_exhausted'; retryAfter: number };

/** The subset of an Open Food Facts v3 product record the function reads (section 4). */
export interface OffRecord {
  code?: unknown;
  product_type?: unknown;
  product_name?: unknown;
  product_name_fr?: unknown;
  generic_name?: unknown;
  generic_name_fr?: unknown;
  brands?: unknown;
  brands_tags?: unknown;
  quantity?: unknown;
  product_quantity?: unknown;
  product_quantity_unit?: unknown;
  categories_tags?: unknown;
  food_groups_tags?: unknown;
  pnns_groups_1?: unknown;
  pnns_groups_2?: unknown;
  stores_tags?: unknown;
  countries_tags?: unknown;
  image_front_small_url?: unknown;
  unique_scans_n?: unknown;
  last_modified_t?: unknown;
  obsolete?: unknown;
}

/** Fields requested from the API (section 4). */
export const OFF_FIELDS =
  'code,product_type,product_name,product_name_fr,generic_name,generic_name_fr,brands,brands_tags,quantity,' +
  'product_quantity,product_quantity_unit,categories_tags,food_groups_tags,pnns_groups_1,pnns_groups_2,' +
  'stores_tags,countries_tags,image_front_small_url,unique_scans_n,last_modified_t,obsolete';
