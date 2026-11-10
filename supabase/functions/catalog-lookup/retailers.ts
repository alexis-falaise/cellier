/** Store tags and retailer signals, section 4.4. Versioned with the code. */
import type { StoreTag } from './types.ts';

/** Lower case, accents folded. */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

const LECLERC_BRANDS = new Set(['marque-repere', 'nos-regions-ont-du-talent', 'eco-plus', 'bio-village']);
const CARREFOUR_BRANDS = new Set(['reflets-de-france', 'simpl']);
const LECLERC_PREFIX = '3564700';
const CARREFOUR_PREFIX = '3560070';

export interface StoreTagInput {
  storesTags: string[];
  brandsTags: string[];
  /** True when the record has no brand at all (prefix hints apply only then). */
  brandless: boolean;
  /** Canonical 14-digit GTIN. */
  gtin: string;
}

export function storeTags(input: StoreTagInput): StoreTag[] {
  const stores = input.storesTags.map(fold);
  // Brand tags are usually bare slugs; tolerate a language prefix such as `xx:`.
  const brands = input.brandsTags.map((b) => fold(b).replace(/^[a-z]{2}:/, ''));
  let leclerc = stores.some((s) => s.includes('leclerc')) || brands.some((b) => LECLERC_BRANDS.has(b));
  let carrefour = stores.some((s) => s.includes('carrefour')) ||
    brands.some((b) => b.startsWith('carrefour') || CARREFOUR_BRANDS.has(b));
  if (input.brandless) {
    const ean13 = input.gtin.slice(1);
    if (ean13.startsWith(LECLERC_PREFIX)) leclerc = true;
    if (ean13.startsWith(CARREFOUR_PREFIX)) carrefour = true;
  }
  const out: StoreTag[] = [];
  if (leclerc) out.push('leclerc');
  if (carrefour) out.push('carrefour');
  return out;
}
