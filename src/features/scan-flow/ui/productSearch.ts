import type { ProductView } from '@/domain/types';

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('fr');

/** Household products whose name or brand contains every word of the query (accents ignored). */
export function searchProducts(views: readonly ProductView[], query: string, limit = 8): ProductView[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const out: ProductView[] = [];
  for (const v of views) {
    const text = fold(`${v.product.name} ${v.product.brand ?? ''}`);
    if (words.every((w) => text.includes(w))) {
      out.push(v);
      if (out.length >= limit) break;
    }
  }
  return out;
}
