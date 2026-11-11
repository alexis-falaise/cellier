/**
 * Open Food Facts family record → `public.catalog_facts` row (snake_case, as stored and as returned
 * by the Edge Function). Pure, no imports, so it runs in Deno and is unit-tested by Vitest
 * (src/features/product-facts/model/facts.test.ts).
 */

export type FactsSource = 'off' | 'obf' | 'opf' | 'opff';
export type NutrientLevel = 'low' | 'moderate' | 'high';

export const NUTRIMENT_KEYS = [
  'energy_kcal',
  'fat',
  'saturated_fat',
  'carbohydrates',
  'sugars',
  'fiber',
  'proteins',
  'salt',
] as const;
export type NutrimentKey = (typeof NUTRIMENT_KEYS)[number];

export const LEVEL_KEYS = ['fat', 'saturated_fat', 'sugars', 'salt'] as const;
export type LevelKey = (typeof LEVEL_KEYS)[number];

export interface CatalogFactsRow {
  gtin: string;
  found: boolean;
  source: FactsSource | null;
  nutriscore_grade: string | null;
  nova_group: number | null;
  ecoscore_grade: string | null;
  nutriments: Partial<Record<NutrimentKey, number>>;
  nutrient_levels: Partial<Record<LevelKey, NutrientLevel>>;
  ingredients_text: string | null;
  allergens: string[];
  traces: string[];
  additives: string[];
  labels: string[];
  analysis: string[];
  origins: string | null;
  period_after_opening_months: number | null;
  source_modified_at: string | null;
  fetched_at?: string;
}

/** Fields requested from `/api/v3/product/{code}?product_type=all`. */
export const FACTS_FIELDS = [
  'code',
  'product_type',
  'nutriscore_grade',
  'nova_group',
  'ecoscore_grade',
  'environmental_score_grade',
  'nutriments',
  'nutrient_levels',
  'ingredients_text_fr',
  'ingredients_text',
  'allergens_tags',
  'traces_tags',
  'additives_tags',
  'labels_tags',
  'ingredients_analysis_tags',
  'origins',
  'origins_tags',
  'periods_after_opening',
  'periods_after_opening_tags',
  'last_modified_t',
].join(',');

/** Found rows are refreshed after 30 days, "not found" after 7. */
export const FACTS_TTL_MS = { found: 30 * 86_400_000, notFound: 7 * 86_400_000 } as const;

export function isFresh(row: Pick<CatalogFactsRow, 'found' | 'fetched_at'>, now: number): boolean {
  const at = row.fetched_at ? Date.parse(row.fetched_at) : Number.NaN;
  if (!Number.isFinite(at)) return false;
  return now - at < (row.found ? FACTS_TTL_MS.found : FACTS_TTL_MS.notFound);
}

const MAX_INGREDIENTS = 5000;
const MAX_TAGS = 40;
const DEFINITE_ANALYSIS = new Set([
  'en:palm-oil',
  'en:palm-oil-free',
  'en:vegan',
  'en:non-vegan',
  'en:vegetarian',
  'en:non-vegetarian',
]);
const LEVELS = new Set<NutrientLevel>(['low', 'moderate', 'high']);
const ECOSCORE = new Set(['a-plus', 'a', 'b', 'c', 'd', 'e', 'f']);

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

export function sourceFromType(productType: unknown, fallback: FactsSource): FactsSource {
  switch (productType) {
    case 'food':
      return 'off';
    case 'beauty':
      return 'obf';
    case 'product':
      return 'opf';
    case 'petfood':
      return 'opff';
    default:
      return fallback;
  }
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
}

const round = (n: number, digits: number) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

function tags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const t of v) {
    if (typeof t !== 'string') continue;
    const s = t.trim().toLowerCase();
    if (s !== '' && /^[a-z]{2}:/.test(s) && !out.includes(s)) out.push(s);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

function nutriments(raw: unknown): Partial<Record<NutrimentKey, number>> {
  if (!isRec(raw)) return {};
  const g = (k: string) => num(raw[`${k}_100g`]);
  const out: Partial<Record<NutrimentKey, number>> = {};
  // `energy_100g` is in kJ, like `energy-kj_100g`.
  const kj = g('energy-kj') ?? g('energy');
  const kcal = g('energy-kcal') ?? (kj === null ? null : kj / 4.184);
  if (kcal !== null && kcal <= 1000) out.energy_kcal = Math.round(kcal);
  const pairs: [NutrimentKey, string][] = [
    ['fat', 'fat'],
    ['saturated_fat', 'saturated-fat'],
    ['carbohydrates', 'carbohydrates'],
    ['sugars', 'sugars'],
    ['fiber', 'fiber'],
    ['proteins', 'proteins'],
    ['salt', 'salt'],
  ];
  for (const [key, off] of pairs) {
    let v = g(off);
    if (key === 'salt' && v === null) {
      const sodium = g('sodium');
      v = sodium === null ? null : sodium * 2.5;
    }
    if (v !== null && v <= 100) out[key] = round(v, 2);
  }
  return out;
}

function nutrientLevels(raw: unknown): Partial<Record<LevelKey, NutrientLevel>> {
  if (!isRec(raw)) return {};
  const out: Partial<Record<LevelKey, NutrientLevel>> = {};
  for (const key of LEVEL_KEYS) {
    const v = raw[key.replace('_', '-')];
    if (typeof v === 'string' && LEVELS.has(v as NutrientLevel)) out[key] = v as NutrientLevel;
  }
  return out;
}

/** OFF marks allergens with underscores (`_lait_`); whitespace is collapsed. */
export function cleanIngredients(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let s = raw.replace(/_([^_\n]{1,80})_/g, '$1').replace(/\s+/g, ' ').trim();
  if (s === '') return null;
  if (s.length > MAX_INGREDIENTS) s = `${s.slice(0, MAX_INGREDIENTS - 1).replace(/\s+\S*$/, '')}…`;
  return s;
}

/** `en:e322i` → `E322i`; non-E-number tags are dropped. */
function additives(v: unknown): string[] {
  const out: string[] = [];
  for (const t of tags(v)) {
    const m = /^[a-z]{2}:e(\d{3,4})([a-z]*)$/.exec(t);
    if (!m) continue;
    const code = `E${m[1]}${m[2] ?? ''}`;
    if (!out.includes(code)) out.push(code);
  }
  return out;
}

function prettyTag(tag: string): string {
  const v = tag.replace(/^[a-z]{2}:/, '').replace(/-/g, ' ').trim();
  return v.charAt(0).toUpperCase() + v.slice(1);
}

function origins(record: Rec): string | null {
  const text = typeof record.origins === 'string' ? record.origins.replace(/\s+/g, ' ').trim() : '';
  const value = text !== '' ? text : tags(record.origins_tags).slice(0, 4).map(prettyTag).join(', ');
  if (value === '') return null;
  return value.length > 160 ? `${value.slice(0, 159)}…` : value;
}

/** `12 M`, `12 months`, `en:12-months` → 12. */
function periodAfterOpening(record: Rec): number | null {
  const candidates = [record.periods_after_opening, ...(Array.isArray(record.periods_after_opening_tags) ? record.periods_after_opening_tags : [])];
  for (const c of candidates) {
    if (typeof c !== 'string') continue;
    const m = /(\d{1,3})/.exec(c);
    const n = m ? Number(m[1]) : Number.NaN;
    if (n >= 1 && n <= 120) return n;
  }
  return null;
}

function grade(v: unknown, allowed: ReadonlySet<string>): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  return allowed.has(s) ? s : null;
}

const NUTRISCORE = new Set(['a', 'b', 'c', 'd', 'e']);

/** A found record → row. Grades and nutrition apply to food only. */
export function normaliseFacts(gtin: string, record: unknown, hostSource: FactsSource): CatalogFactsRow {
  const r = isRec(record) ? record : {};
  const source = sourceFromType(r.product_type, hostSource);
  const food = source === 'off';
  const nova = num(r.nova_group);
  const modified = num(r.last_modified_t);
  return {
    gtin,
    found: true,
    source,
    nutriscore_grade: food ? grade(r.nutriscore_grade, NUTRISCORE) : null,
    nova_group: food && nova !== null && Number.isInteger(nova) && nova >= 1 && nova <= 4 ? nova : null,
    ecoscore_grade: food ? grade(r.environmental_score_grade, ECOSCORE) ?? grade(r.ecoscore_grade, ECOSCORE) : null,
    nutriments: food ? nutriments(r.nutriments) : {},
    nutrient_levels: food ? nutrientLevels(r.nutrient_levels) : {},
    ingredients_text: cleanIngredients(r.ingredients_text_fr) ?? cleanIngredients(r.ingredients_text),
    allergens: tags(r.allergens_tags),
    traces: tags(r.traces_tags),
    additives: additives(r.additives_tags),
    labels: tags(r.labels_tags),
    analysis: tags(r.ingredients_analysis_tags).filter((t) => DEFINITE_ANALYSIS.has(t)),
    origins: origins(r),
    period_after_opening_months: source === 'obf' ? periodAfterOpening(r) : null,
    source_modified_at: modified !== null && modified > 0 ? new Date(modified * 1000).toISOString() : null,
  };
}

export function notFoundFacts(gtin: string): CatalogFactsRow {
  return {
    gtin,
    found: false,
    source: null,
    nutriscore_grade: null,
    nova_group: null,
    ecoscore_grade: null,
    nutriments: {},
    nutrient_levels: {},
    ingredients_text: null,
    allergens: [],
    traces: [],
    additives: [],
    labels: [],
    analysis: [],
    origins: null,
    period_after_opening_months: null,
    source_modified_at: null,
  };
}
