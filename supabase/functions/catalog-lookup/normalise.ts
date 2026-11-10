/** Normalisation of an Open Food Facts record, section 4 (live API path). Dependency-free. */
import { CATEGORY_RULES, mapCategory } from './category.ts';
import { cutAtWord, parseQuantity } from './quantity.ts';
import { storeTags } from './retailers.ts';
import type {
  CatalogLookupDraft,
  CatalogProduct,
  CategoryRulesArtefact,
  OffRecord,
  UpstreamSource,
} from './types.ts';

export type NormaliseResult =
  | { ok: true; product: CatalogProduct; categoryTags: string[] }
  | { ok: false; draft: CatalogLookupDraft };

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Section 4.1: first non-empty candidate, cleaned; null if unusable. */
export function normaliseName(record: OffRecord): string | null {
  const candidates = [record.product_name_fr, record.product_name, record.generic_name_fr, record.generic_name];
  const first = candidates.map(str).find((s) => s !== null && s.trim() !== '');
  if (!first) return null;
  let s = first.normalize('NFC').replace(/\s+/g, ' ').trim();
  const stripped = s.replace(/[*!_]+$/u, '').trim();
  if (stripped !== s && /\p{L}/u.test(stripped)) s = stripped;
  const cut = cutAtWord(s, 200);
  if (!cut) return null;
  // Spec: digits only or one character -> rejected. Also rejected: no letter or digit at all (e.g. `***`).
  if (/^\d+$/.test(cut.replace(/\s/g, '')) || [...cut].length < 2 || !/[\p{L}\p{N}]/u.test(cut)) return null;
  return cut;
}

/** Section 4.2. */
export function normaliseBrand(brands: unknown): string | null {
  const s = str(brands);
  if (!s) return null;
  const first = s.split(',')[0].replace(/\s+/g, ' ').trim();
  if (first === '') return null;
  return first.length > 120 ? first.slice(0, 120).trim() : first;
}

/** Section 4.6: `product_type` -> source. */
export function sourceFromProductType(t: unknown): UpstreamSource | null {
  switch (t) {
    case 'food':
      return 'off';
    case 'beauty':
      return 'obf';
    case 'product':
      return 'opf';
    case 'petfood':
      return 'opff';
    default:
      return null;
  }
}

/** Source from the host that answered (after redirects), when `product_type` is missing. */
export function sourceFromUrl(url: string): UpstreamSource | null {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  if (host.endsWith('openfoodfacts.org')) return 'off';
  if (host.endsWith('openbeautyfacts.org')) return 'obf';
  if (host.endsWith('openproductsfacts.org')) return 'opf';
  if (host.endsWith('openpetfoodfacts.org')) return 'opff';
  return null;
}

function imageUrl(v: unknown): string | null {
  const s = str(v)?.trim();
  if (!s || s.length > 500 || !/^https:\/\//.test(s)) return null;
  return s;
}

function popularity(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.trunc(n), 2_147_483_647);
}

function modifiedAt(v: unknown): string | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n * 1000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * `gtin` is the canonical key from the request (the record's `code` may be in another form).
 * `rules` defaults to the bundled artefact (null until it exists: category left null).
 */
export function normalise(
  record: OffRecord,
  source: UpstreamSource,
  gtin: string,
  rules: CategoryRulesArtefact | null = CATEGORY_RULES,
): NormaliseResult {
  const name = normaliseName(record);
  const brand = normaliseBrand(record.brands);
  const q = parseQuantity({
    quantity: str(record.quantity),
    productQuantity: typeof record.product_quantity === 'number' ? record.product_quantity : str(record.product_quantity),
    productQuantityUnit: str(record.product_quantity_unit),
  });
  const categoriesTags = strList(record.categories_tags);
  const category = rules
    ? mapCategory(
      {
        source,
        categoriesTags,
        foodGroupsTags: strList(record.food_groups_tags),
        pnnsGroups1: str(record.pnns_groups_1),
        pnnsGroups2: str(record.pnns_groups_2),
        name: name ?? '',
      },
      rules,
    )
    : null;
  const image = imageUrl(record.image_front_small_url);

  if (!name) {
    return {
      ok: false,
      draft: {
        brand,
        quantityLabel: q.quantityLabel,
        netQuantity: q.netQuantity,
        netUnit: q.netUnit,
        packCount: q.packCount,
        categoryKey: category?.categoryKey ?? null,
        imageUrl: image,
      },
    };
  }

  const brandsTags = strList(record.brands_tags);
  return {
    ok: true,
    categoryTags: categoriesTags.slice(0, 100),
    product: {
      gtin,
      name,
      brand,
      quantityLabel: q.quantityLabel,
      netQuantity: q.netQuantity,
      netUnit: q.netUnit,
      packCount: q.packCount,
      categoryKey: category?.categoryKey ?? null,
      categoryRule: category?.categoryRule ?? null,
      imageUrl: image,
      source,
      storeTags: storeTags({
        storesTags: strList(record.stores_tags),
        brandsTags,
        brandless: brand === null && brandsTags.length === 0,
        gtin,
      }),
      popularity: popularity(record.unique_scans_n),
      priceCents: null,
      priceObservedOn: null,
      priceChain: null,
      sourceModifiedAt: modifiedAt(record.last_modified_t),
    },
  };
}
