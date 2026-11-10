import type { Category, CategoryId, CategoryKey, Gtin, MutationArgs, ProductId } from '@/domain/types';
import { type CatalogProduct, PRICE_DISPLAY_MAX_AGE_DAYS } from './types';

const DAY_MS = 86_400_000;

/**
 * 05 §5.4: the live household category whose templateKey is the catalogue slug, else the live
 * 'autre' category, else null («Sans catégorie»).
 */
export function resolveHouseholdCategory(
  categories: readonly Pick<Category, 'id' | 'templateKey' | 'deletedAt'>[],
  key: CategoryKey | null,
): CategoryId | null {
  const live = categories.filter((c) => c.deletedAt === null);
  const find = (k: CategoryKey) => live.find((c) => c.templateKey === k)?.id ?? null;
  return (key !== null ? find(key) : null) ?? find('autre');
}

/** 05 §7.5: a catalogue price is usable only when observed at most 365 days before `now`. */
export function displayablePriceCents(product: CatalogProduct, now: number): number | null {
  if (product.priceCents === null || product.priceObservedOn === null) return null;
  const observed = Date.parse(`${product.priceObservedOn}T00:00:00Z`);
  if (!Number.isFinite(observed) || now - observed > PRICE_DISPLAY_MAX_AGE_DAYS * DAY_MS) return null;
  return product.priceCents;
}

export interface NewProductFromCatalogue {
  /** Payload of the `product.create` mutation (05 §8.2). */
  args: MutationArgs['product.create'];
  /** Catalogue category slug the household category was chosen from. */
  categoryKey: CategoryKey | null;
}

/**
 * Maps a catalogue row to the `product.create` payload: name, brand, GTIN and catalogue link,
 * net quantity/unit, pack count, image, household category from the slug, and the price with
 * `priceSource 'catalog'` when it is recent enough. The user can still edit everything before saving.
 */
export function catalogueToProductCreate(
  product: CatalogProduct,
  options: {
    productId: ProductId;
    categories: readonly Pick<Category, 'id' | 'templateKey' | 'deletedAt'>[];
    now: number;
  },
): NewProductFromCatalogue {
  const priceCents = displayablePriceCents(product, options.now);
  const gtin: Gtin = product.gtin;
  return {
    args: {
      productId: options.productId,
      name: product.name,
      brand: product.brand,
      gtin,
      catalogGtin: gtin,
      categoryId: resolveHouseholdCategory(options.categories, product.categoryKey),
      netQuantity: product.netQuantity,
      netUnit: product.netUnit,
      packCount: product.packCount,
      imageUrl: product.imageUrl,
      priceCents,
      priceSource: priceCents !== null ? 'catalog' : null,
    },
    categoryKey: product.categoryKey,
  };
}
