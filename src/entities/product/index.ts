import type { Gtin, Product, ProductView } from '@/domain/types';
import { useStore } from '@/shared/sync';
import {
  selectDeletedProducts,
  selectLowProducts,
  selectProductsByGtin,
  selectProductView,
  selectProductViews,
  selectProductViewsByCategory,
} from './model';

export * from './model';

/** Live products with household totals, sorted by name. */
export function useProductViews(): readonly ProductView[] {
  return useStore(selectProductViews);
}

/** One product (aliases resolved); undefined when unknown. */
export function useProductView(productId: string): ProductView | undefined {
  return useStore(selectProductView(productId));
}

export function useProductByGtin(gtin: Gtin | string | null): Product | undefined {
  return useStore((s) => (gtin ? selectProductsByGtin(s).get(gtin) : undefined));
}

export function useLowProducts(): readonly ProductView[] {
  return useStore(selectLowProducts);
}

export function useProductViewsByCategory(categoryId: string | null): readonly ProductView[] {
  return useStore(selectProductViewsByCategory(categoryId));
}

export function useDeletedProducts(): readonly Product[] {
  return useStore(selectDeletedProducts);
}
