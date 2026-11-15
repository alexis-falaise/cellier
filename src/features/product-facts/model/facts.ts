/**
 * Product facts as the item sheet shows them: parsed from a `catalog_facts` row (PostgREST or the
 * `product-facts` Edge Function), plus the names of the taxonomy tags in the active language.
 */
import { type MessageKey, t } from '@/shared/i18n';
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
// Taxonomy names, in the active language. Unknown tags fall back to the tag value, prettified.
// ---------------------------------------------------------------------------------------------

type AllergenKey = Extract<MessageKey, `facts.allergen.${string}`>;

const ALLERGENS: Record<string, AllergenKey> = {
  'en:gluten': 'facts.allergen.gluten',
  'en:crustaceans': 'facts.allergen.crustaceans',
  'en:eggs': 'facts.allergen.eggs',
  'en:fish': 'facts.allergen.fish',
  'en:peanuts': 'facts.allergen.peanuts',
  'en:soybeans': 'facts.allergen.soybeans',
  'en:milk': 'facts.allergen.milk',
  'en:nuts': 'facts.allergen.nuts',
  'en:celery': 'facts.allergen.celery',
  'en:mustard': 'facts.allergen.mustard',
  'en:sesame-seeds': 'facts.allergen.sesame',
  'en:sulphur-dioxide-and-sulphites': 'facts.allergen.sulphites',
  'en:lupin': 'facts.allergen.lupin',
  'en:molluscs': 'facts.allergen.molluscs',
};

/** A translated name (`key`), or a proper name that reads the same in every language (`name`). */
type LabelName = { key: PlainKey } | { name: string };
type PlainKey = Extract<MessageKey, `facts.label.${string}` | `facts.analysis.${string}`>;

/** Known labels, in the order their chips are shown. */
const LABELS: Record<string, LabelName> = {
  'en:organic': { key: 'facts.label.organic' },
  'en:eu-organic': { key: 'facts.label.euOrganic' },
  'fr:ab-agriculture-biologique': { name: 'AB Agriculture biologique' },
  'en:fair-trade': { key: 'facts.label.fairTrade' },
  'en:fairtrade-international': { name: 'Fairtrade' },
  'en:max-havelaar': { name: 'Max Havelaar' },
  'en:rainforest-alliance': { name: 'Rainforest Alliance' },
  'en:utz-certified': { name: 'UTZ' },
  'en:vegan': { key: 'facts.label.vegan' },
  'en:vegetarian': { key: 'facts.label.vegetarian' },
  'en:no-gluten': { key: 'facts.label.noGluten' },
  'en:no-lactose': { key: 'facts.label.noLactose' },
  'en:no-palm-oil': { key: 'facts.label.noPalmOil' },
  'en:no-preservatives': { key: 'facts.label.noPreservatives' },
  'en:no-colorings': { key: 'facts.label.noColorings' },
  'en:no-additives': { key: 'facts.label.noAdditives' },
  'en:no-added-sugar': { key: 'facts.label.noAddedSugar' },
  'en:no-gmos': { key: 'facts.label.noGmos' },
  'en:made-in-france': { key: 'facts.label.madeInFrance' },
  'fr:origine-france': { key: 'facts.label.frenchOrigin' },
  'fr:label-rouge': { name: 'Label Rouge' },
  'en:pdo': { key: 'facts.label.pdo' },
  'en:pgi': { key: 'facts.label.pgi' },
  'fr:aoc': { name: 'AOC' },
  'en:tsg': { key: 'facts.label.tsg' },
  'en:sustainable-seafood-msc': { key: 'facts.label.msc' },
  'en:msc': { key: 'facts.label.msc' },
  'en:asc': { key: 'facts.label.asc' },
  'fr:bleu-blanc-coeur': { name: 'Bleu-Blanc-Cœur' },
  'en:eu-ecolabel': { key: 'facts.label.euEcolabel' },
  'en:ecolabel': { key: 'facts.label.ecolabel' },
  'en:ecocert': { name: 'Ecocert' },
  'fr:cosmebio': { name: 'Cosmébio' },
  'en:cosmos-organic': { name: 'Cosmos Organic' },
  'en:without-perfume': { key: 'facts.label.noPerfume' },
  'en:not-tested-on-animals': { key: 'facts.label.notTestedOnAnimals' },
  'en:cruelty-free': { key: 'facts.label.crueltyFree' },
  'en:fsc': { name: 'FSC' },
  'en:pefc': { name: 'PEFC' },
};

/** Logos and administrative marks that say nothing about the product. */
const HIDDEN_LABEL =
  /nutriscore|nutri-score|triman|green-dot|point-vert|eco-emballages|citeo|info-tri|recycl|^[a-z]{2}:pme-plus$|ecoscore|green-score/;

export function allergenName(tag: string): string {
  const key = ALLERGENS[tag];
  return key ? t(key) : prettyTag(tag);
}

export function labelName(tag: string): string {
  const label = LABELS[tag];
  if (!label) return prettyTag(tag);
  return 'key' in label ? t(label.key) : label.name;
}

/** Labels worth a chip: known first (in table order), then up to `max` in all. */
export function visibleLabels(f: Pick<ProductFacts, 'labels' | 'analysis'>, max = 10): string[] {
  const tags = f.labels.filter((tag) => !HIDDEN_LABEL.test(tag) && /^[a-z]{2}:/.test(tag));
  const known = tags.filter((tag) => tag in LABELS);
  const unknown = tags.filter((tag) => !(tag in LABELS) && tag.startsWith('fr:'));
  const names: string[] = [];
  for (const tag of [...known, ...unknown]) {
    const n = labelName(tag);
    if (!names.includes(n)) names.push(n);
  }
  return names.slice(0, max);
}

export type AnalysisChip = { key: string; label: string; tone: 'positive' | 'warning' };

/** Palm oil, vegan, vegetarian, from the definite analysis tags; vegan supersedes vegetarian. */
export function analysisChips(f: Pick<ProductFacts, 'analysis' | 'labels'>): AnalysisChip[] {
  const has = (tag: string) => f.analysis.includes(tag);
  const out: AnalysisChip[] = [];
  if (has('en:palm-oil')) out.push({ key: 'palm', label: t('facts.analysis.palmOil'), tone: 'warning' });
  else if (has('en:palm-oil-free')) out.push({ key: 'palm', label: t('facts.label.noPalmOil'), tone: 'positive' });
  if (has('en:vegan')) out.push({ key: 'veg', label: t('facts.label.vegan'), tone: 'positive' });
  else if (has('en:vegetarian')) out.push({ key: 'veg', label: t('facts.label.vegetarian'), tone: 'positive' });
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
