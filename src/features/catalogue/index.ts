/**
 * Product catalogue client (05-catalogue.md §8–§9): scan lookup chain, catalogue search and the
 * mapping of a catalogue row to a new household product. The Supabase client is injected.
 */
export type { CatalogueClient, PostgrestErrorLike, PostgrestResultLike } from './model/client';
export type { CatalogueLookup, CatalogueLookupDeps, LocalLookupResult, LookupOptions } from './model/lookup';
export { createCatalogueLookup } from './model/lookup';
export { NegativeCache } from './model/negativeCache';
export { isGtin14, parseFunctionProduct, toCatalogProduct } from './model/row';
export type { CatalogSearchDeps, CatalogSearchResult } from './model/search';
export { createCatalogSearcher, searchCatalog } from './model/search';
export type { NewProductFromCatalogue } from './model/toProduct';
export { catalogueToProductCreate, displayablePriceCents, resolveHouseholdCategory } from './model/toProduct';
export type * from './model/types';
export {
  CATALOG_SELECT_COLUMNS,
  CATALOGUE_SEARCH,
  CATALOGUE_TIMEOUTS,
  PRICE_DISPLAY_MAX_AGE_DAYS,
} from './model/types';
