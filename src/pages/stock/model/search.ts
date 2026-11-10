/**
 * Stock search (design 03 §4.5.2): MiniSearch over name, brand, category name and barcode digits,
 * with diacritic folding («pate» finds «Pâtes») and prefix matching («3017» finds a Nutella jar
 * whose GTIN-14 is 03017620422003). One index, rebuilt only when the documents change.
 */
import MiniSearch from 'minisearch';
import { fold } from '@/shared/i18n/text';

export interface StockSearchDoc {
  id: string;
  name: string;
  brand: string;
  category: string;
  /** Barcode variants: GTIN-14 and the printed EAN-13 without its leading zero. */
  barcode: string;
}

export interface StockSearch {
  /** Product ids by relevance; empty for a blank query. */
  search(query: string): string[];
}

function barcodeVariants(gtin: string | null): string {
  if (!gtin) return '';
  const trimmed = gtin.replace(/^0+/, '');
  return trimmed === gtin ? gtin : `${gtin} ${trimmed}`;
}

export function toSearchDoc(product: {
  id: string;
  name: string;
  brand: string | null;
  gtin: string | null;
  categoryName: string | null;
}): StockSearchDoc {
  return {
    id: product.id,
    name: product.name,
    brand: product.brand ?? '',
    category: product.categoryName ?? '',
    barcode: barcodeVariants(product.gtin),
  };
}

/** Splits on anything that is not a letter or a digit (apostrophes and hyphens included). */
const tokenize = (text: string): string[] => text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

const processTerm = (term: string): string | null => {
  const folded = fold(term);
  return folded.length > 0 ? folded : null;
};

export function createStockSearch(docs: readonly StockSearchDoc[]): StockSearch {
  const index = new MiniSearch<StockSearchDoc>({
    fields: ['name', 'brand', 'category', 'barcode'],
    idField: 'id',
    tokenize,
    processTerm,
    searchOptions: {
      prefix: true,
      fuzzy: (term) => (term.length >= 5 ? 0.15 : false),
      combineWith: 'AND',
      boost: { name: 3, brand: 1.5, category: 1, barcode: 1 },
      tokenize,
      processTerm,
    },
  });
  index.addAll(docs);
  return {
    search(query: string): string[] {
      if (query.trim() === '') return [];
      return index.search(query).map((r) => String(r.id));
    },
  };
}
