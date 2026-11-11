/**
 * Product facts as the item sheet shows them: parsed from a `catalog_facts` row (PostgREST or the
 * `product-facts` Edge Function), plus the French names of the taxonomy tags.
 */
import {
  type CatalogFactsRow,
  type FactsSource,
  isFresh,
  LEVEL_KEYS,
  type LevelKey,
  NUTRIMENT_KEYS,
  type NutrientLevel,
  type NutrimentKey,
} from '../../../../supabase/functions/product-facts/facts.ts';

export type { CatalogFactsRow, FactsSource, LevelKey, NutrientLevel, NutrimentKey };
export { isFresh, LEVEL_KEYS, NUTRIMENT_KEYS };

export const FACTS_SELECT_COLUMNS =
  'gtin,found,source,nutriscore_grade,nova_group,ecoscore_grade,nutriments,nutrient_levels,ingredients_text,' +
  'allergens,traces,additives,labels,analysis,origins,period_after_opening_months,source_modified_at,fetched_at';

export type NutriScoreGrade = 'a' | 'b' | 'c' | 'd' | 'e';
export type NovaGroup = 1 | 2 | 3 | 4;
export type EcoScoreGrade = 'a-plus' | 'a' | 'b' | 'c' | 'd' | 'e' | 'f';

export interface ProductFacts {
  gtin: string;
  found: boolean;
  source: FactsSource | null;
  nutriscore: NutriScoreGrade | null;
  nova: NovaGroup | null;
  ecoscore: EcoScoreGrade | null;
  nutriments: Partial<Record<NutrimentKey, number>>;
  levels: Partial<Record<LevelKey, NutrientLevel>>;
  ingredients: string | null;
  allergens: string[];
  traces: string[];
  additives: string[];
  labels: string[];
  analysis: string[];
  origins: string | null;
  afterOpeningMonths: number | null;
  fetchedAt: string;
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const pick = <T extends string>(v: unknown, allowed: readonly T[]): T | null =>
  allowed.includes(v as T) ? (v as T) : null;

const SOURCES: readonly FactsSource[] = ['off', 'obf', 'opf', 'opff'];
const NUTRI: readonly NutriScoreGrade[] = ['a', 'b', 'c', 'd', 'e'];
const ECO: readonly EcoScoreGrade[] = ['a-plus', 'a', 'b', 'c', 'd', 'e', 'f'];
const LEVELS: readonly NutrientLevel[] = ['low', 'moderate', 'high'];

/** Defensive parse of a row; null when it is not a facts row. */
export function toProductFacts(v: unknown): ProductFacts | null {
  if (!isRec(v) || typeof v.gtin !== 'string' || typeof v.found !== 'boolean') return null;
  const nutriments: Partial<Record<NutrimentKey, number>> = {};
  if (isRec(v.nutriments)) {
    for (const k of NUTRIMENT_KEYS) {
      const n = v.nutriments[k];
      if (typeof n === 'number' && Number.isFinite(n)) nutriments[k] = n;
    }
  }
  const levels: Partial<Record<LevelKey, NutrientLevel>> = {};
  if (isRec(v.nutrient_levels)) {
    for (const k of LEVEL_KEYS) {
      const l = pick(v.nutrient_levels[k], LEVELS);
      if (l) levels[k] = l;
    }
  }
  const nova =
    typeof v.nova_group === 'number' && [1, 2, 3, 4].includes(v.nova_group) ? (v.nova_group as NovaGroup) : null;
  const months = v.period_after_opening_months;
  return {
    gtin: v.gtin,
    found: v.found,
    source: pick(v.source, SOURCES),
    nutriscore: pick(v.nutriscore_grade, NUTRI),
    nova,
    ecoscore: pick(v.ecoscore_grade, ECO),
    nutriments,
    levels,
    ingredients: str(v.ingredients_text),
    allergens: strings(v.allergens),
    traces: strings(v.traces),
    additives: strings(v.additives),
    labels: strings(v.labels),
    analysis: strings(v.analysis),
    origins: str(v.origins),
    afterOpeningMonths: typeof months === 'number' && months >= 1 ? months : null,
    fetchedAt: typeof v.fetched_at === 'string' ? v.fetched_at : new Date(0).toISOString(),
  };
}

export function factsAreFresh(facts: ProductFacts, now: number): boolean {
  return isFresh({ found: facts.found, fetched_at: facts.fetchedAt }, now);
}

/** True when the sheet has something to show beyond the attribution. */
export function hasDisplayableFacts(f: ProductFacts): boolean {
  return (
    f.found &&
    (f.nutriscore !== null ||
      f.nova !== null ||
      f.ecoscore !== null ||
      Object.keys(f.nutriments).length > 0 ||
      Object.keys(f.levels).length > 0 ||
      f.ingredients !== null ||
      f.allergens.length > 0 ||
      f.traces.length > 0 ||
      f.additives.length > 0 ||
      visibleLabels(f).length > 0 ||
      f.origins !== null ||
      f.afterOpeningMonths !== null)
  );
}

// ---------------------------------------------------------------------------------------------
// Taxonomy names (French). Unknown tags fall back to the tag value, prettified.
// ---------------------------------------------------------------------------------------------

const ALLERGENS: Record<string, string> = {
  'en:gluten': 'Gluten',
  'en:crustaceans': 'Crustacés',
  'en:eggs': 'Œufs',
  'en:fish': 'Poisson',
  'en:peanuts': 'Arachides',
  'en:soybeans': 'Soja',
  'en:milk': 'Lait',
  'en:nuts': 'Fruits à coque',
  'en:celery': 'Céleri',
  'en:mustard': 'Moutarde',
  'en:sesame-seeds': 'Sésame',
  'en:sulphur-dioxide-and-sulphites': 'Sulfites',
  'en:lupin': 'Lupin',
  'en:molluscs': 'Mollusques',
};

const LABELS: Record<string, string> = {
  'en:organic': 'Bio',
  'en:eu-organic': 'Bio européen',
  'fr:ab-agriculture-biologique': 'AB Agriculture biologique',
  'en:fair-trade': 'Commerce équitable',
  'en:fairtrade-international': 'Fairtrade',
  'en:max-havelaar': 'Max Havelaar',
  'en:rainforest-alliance': 'Rainforest Alliance',
  'en:utz-certified': 'UTZ',
  'en:vegan': 'Végan',
  'en:vegetarian': 'Végétarien',
  'en:no-gluten': 'Sans gluten',
  'en:no-lactose': 'Sans lactose',
  'en:no-palm-oil': 'Sans huile de palme',
  'en:no-preservatives': 'Sans conservateurs',
  'en:no-colorings': 'Sans colorants',
  'en:no-additives': 'Sans additifs',
  'en:no-added-sugar': 'Sans sucres ajoutés',
  'en:no-gmos': 'Sans OGM',
  'en:made-in-france': 'Fabriqué en France',
  'fr:origine-france': 'Origine France',
  'fr:label-rouge': 'Label Rouge',
  'en:pdo': 'AOP',
  'en:pgi': 'IGP',
  'fr:aoc': 'AOC',
  'en:tsg': 'STG',
  'en:sustainable-seafood-msc': 'Pêche durable MSC',
  'en:msc': 'Pêche durable MSC',
  'en:asc': 'Aquaculture responsable ASC',
  'fr:bleu-blanc-coeur': 'Bleu-Blanc-Cœur',
  'en:eu-ecolabel': 'Écolabel européen',
  'en:ecolabel': 'Écolabel',
  'en:ecocert': 'Ecocert',
  'fr:cosmebio': 'Cosmébio',
  'en:cosmos-organic': 'Cosmos Organic',
  'en:without-perfume': 'Sans parfum',
  'en:not-tested-on-animals': 'Non testé sur les animaux',
  'en:cruelty-free': 'Cruelty free',
  'en:fsc': 'FSC',
  'en:pefc': 'PEFC',
};

/** Logos and administrative marks that say nothing about the product. */
const HIDDEN_LABEL =
  /nutriscore|nutri-score|triman|green-dot|point-vert|eco-emballages|citeo|info-tri|recycl|^[a-z]{2}:pme-plus$|ecoscore|green-score/;

export function allergenName(tag: string): string {
  return ALLERGENS[tag] ?? prettyTag(tag);
}

export function labelName(tag: string): string {
  return LABELS[tag] ?? prettyTag(tag);
}

/** Labels worth a chip: known first (in table order), then up to `max` in all. */
export function visibleLabels(f: Pick<ProductFacts, 'labels' | 'analysis'>, max = 10): string[] {
  const tags = f.labels.filter((t) => !HIDDEN_LABEL.test(t) && /^[a-z]{2}:/.test(t));
  const known = tags.filter((t) => t in LABELS);
  const unknown = tags.filter((t) => !(t in LABELS) && t.startsWith('fr:'));
  const names: string[] = [];
  for (const t of [...known, ...unknown]) {
    const n = labelName(t);
    if (!names.includes(n)) names.push(n);
  }
  return names.slice(0, max);
}

export type AnalysisChip = { key: string; label: string; tone: 'positive' | 'warning' };

/** Palm oil, vegan, vegetarian, from the definite analysis tags; vegan supersedes vegetarian. */
export function analysisChips(f: Pick<ProductFacts, 'analysis' | 'labels'>): AnalysisChip[] {
  const has = (t: string) => f.analysis.includes(t);
  const out: AnalysisChip[] = [];
  if (has('en:palm-oil')) out.push({ key: 'palm', label: 'Huile de palme', tone: 'warning' });
  else if (has('en:palm-oil-free')) out.push({ key: 'palm', label: 'Sans huile de palme', tone: 'positive' });
  if (has('en:vegan')) out.push({ key: 'veg', label: 'Végan', tone: 'positive' });
  else if (has('en:vegetarian')) out.push({ key: 'veg', label: 'Végétarien', tone: 'positive' });
  return out;
}

export function prettyTag(tag: string): string {
  const v = tag
    .replace(/^[a-z]{2}:/, '')
    .replace(/-/g, ' ')
    .trim();
  return v.charAt(0).toUpperCase() + v.slice(1);
}

/** OFF product page on the database that holds the product. */
export function factsSourceUrl(source: FactsSource | null, gtin: string): string {
  const host =
    source === 'obf'
      ? 'world.openbeautyfacts.org'
      : source === 'opf'
        ? 'world.openproductsfacts.org'
        : source === 'opff'
          ? 'world.openpetfoodfacts.org'
          : 'world.openfoodfacts.org';
  return `https://${host}/product/${encodeURIComponent(gtin)}`;
}
