/**
 * Builds the category rules artefact (docs/architecture/05-catalogue.md §5.2) from
 * scripts/catalogue/category-rules.source.json and the five Open Food Facts family taxonomies.
 *
 * Usage (Node 22.18+ runs TypeScript directly):
 *   node scripts/catalogue/build-category-rules.ts [--offline]
 * Taxonomies are cached in scripts/catalogue/out/taxonomies/ (git-ignored); --offline reuses them.
 * Output: supabase/functions/_shared/catalogue/category-rules.json (generated, committed, never hand-edited).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalTagForm, mapCategory } from '../../supabase/functions/catalog-lookup/category.ts';
import type { CategoryRulesArtefact } from '../../supabase/functions/catalog-lookup/types.ts';
import { CATEGORY_KEYS } from '../../supabase/functions/catalog-lookup/types.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCE = join(ROOT, 'scripts/catalogue/category-rules.source.json');
const TAX_DIR = join(ROOT, 'scripts/catalogue/out/taxonomies');
const OUT = join(ROOT, 'supabase/functions/_shared/catalogue/category-rules.json');
const MIGRATION = join(ROOT, 'supabase/migrations/20261110120200_reference_data.sql');
const MAX_BYTES = 3 * 1024 * 1024;

const TAXONOMIES = {
  food: 'https://static.openfoodfacts.org/data/taxonomies/categories.json',
  products: 'https://static.openproductsfacts.org/data/taxonomies/categories.json',
  beauty: 'https://static.openbeautyfacts.org/data/taxonomies/categories.json',
  petfood: 'https://static.openpetfoodfacts.org/data/taxonomies/categories.json',
  food_groups: 'https://static.openfoodfacts.org/data/taxonomies/food_groups.full.json',
} as const;
type TaxName = keyof typeof TAXONOMIES;

interface TaxEntry {
  name?: Record<string, string>;
  parents?: string[];
}
interface Source {
  version: number;
  tier0: Record<string, string[]>;
  tier1: Record<string, string[]>;
  tier2: Record<string, string[]>;
  pnns2: Record<string, string>;
  pnns1: Record<string, string>;
  extraFoodGroups: Record<string, string>;
  nameRegexes: Array<{ pattern: string; categoryKey: string }>;
  databaseDefaults: Record<string, string>;
  ignoredTags: string[];
  finalFallback: 'autre';
}

const offline = process.argv.includes('--offline');
const problems: string[] = [];

async function loadTaxonomy(
  name: TaxName,
): Promise<{ data: Record<string, TaxEntry>; meta: CategoryRulesArtefact['taxonomies'][TaxName] }> {
  const file = join(TAX_DIR, `${name}.json`);
  let lastModified: string | null = null;
  if (!offline || !existsSync(file)) {
    const res = await fetch(TAXONOMIES[name], { headers: { 'User-Agent': 'Cellier catalogue seed (open source)' } });
    if (!res.ok) throw new Error(`${TAXONOMIES[name]}: HTTP ${res.status}`);
    lastModified = res.headers.get('last-modified');
    mkdirSync(TAX_DIR, { recursive: true });
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  const raw = readFileSync(file);
  const data = JSON.parse(raw.toString('utf8')) as Record<string, TaxEntry>;
  return {
    data,
    meta: {
      url: TAXONOMIES[name],
      sha256: createHash('sha256').update(raw).digest('hex'),
      lastModified,
      entries: Object.keys(data).length,
    },
  };
}

/** `Liquide vaisselle` under prefix `fr` -> `fr:liquide-vaisselle`, the form mapCategory looks up. */
const slugTag = (prefix: string, name: string) => canonicalTagForm(`${prefix}:${name}`);

function invert(tier: Record<string, string[]>, label: string, seen: Map<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [cat, tags] of Object.entries(tier)) {
    for (const tag of tags) {
      if (seen.has(tag)) problems.push(`tag ${tag} appears twice (${seen.get(tag)} and ${label}:${cat})`);
      seen.set(tag, `${label}:${cat}`);
      out[tag] = cat;
    }
  }
  return out;
}

function sortKeys<T>(o: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

async function main() {
  const source = JSON.parse(readFileSync(SOURCE, 'utf8')) as Source;
  const tax = {} as Record<TaxName, Awaited<ReturnType<typeof loadTaxonomy>>>;
  for (const name of Object.keys(TAXONOMIES) as TaxName[]) tax[name] = await loadTaxonomy(name);

  // 1. Merge the four category taxonomies (union of parents).
  const parents = new Map<string, Set<string>>();
  const names = new Map<string, Record<string, string>>();
  for (const name of ['food', 'products', 'beauty', 'petfood'] as const) {
    for (const [tag, entry] of Object.entries(tax[name].data)) {
      const set = parents.get(tag) ?? new Set<string>();
      for (const p of entry.parents ?? []) set.add(p);
      parents.set(tag, set);
      names.set(tag, { ...(names.get(tag) ?? {}), ...(entry.name ?? {}) });
    }
  }

  // 2. Validate.
  const migrationKeys = [...readFileSync(MIGRATION, 'utf8').matchAll(/^\s*\('([a-z_]+)',\s*'/gm)].map((m) => m[1]);
  const contractKeys = [...CATEGORY_KEYS] as string[];
  if (migrationKeys.join() !== contractKeys.join()) {
    problems.push(`category keys differ: migration [${migrationKeys}] vs contract [${contractKeys}]`);
  }
  const isKey = (k: string) => contractKeys.includes(k);
  const seen = new Map<string, string>();
  const tagRules = {
    tier0: invert(source.tier0, 'tier0', seen),
    tier1: invert(source.tier1, 'tier1', seen),
    tier2: invert(source.tier2, 'tier2', seen),
  };
  for (const [tag, where] of seen) {
    if (!parents.has(tag)) problems.push(`rule tag ${tag} (${where}) not found in any taxonomy`);
    if (!isKey(where.split(':')[1])) problems.push(`unknown category in ${where}`);
  }
  const foodGroups: Record<string, string> = {};
  for (const [label, cat] of Object.entries(source.pnns2)) foodGroups[slugTag('en', label)] = cat;
  Object.assign(foodGroups, source.extraFoodGroups);
  for (const [g, cat] of Object.entries(foodGroups)) {
    if (!(g in tax.food_groups.data)) problems.push(`food group ${g} not in food_groups.full.json`);
    if (!isKey(cat)) problems.push(`food group ${g}: unknown category ${cat}`);
  }
  for (const m of [source.pnns2, source.pnns1, source.databaseDefaults]) {
    for (const [k, cat] of Object.entries(m)) if (!isKey(cat)) problems.push(`${k}: unknown category ${cat}`);
  }
  source.nameRegexes.forEach((r, i) => {
    try {
      new RegExp(r.pattern, 'iu');
    } catch (e) {
      problems.push(`nameRegexes[${i}] does not compile: ${(e as Error).message}`);
    }
    if (!isKey(r.categoryKey)) problems.push(`nameRegexes[${i}]: unknown category ${r.categoryKey}`);
  });
  if (problems.length) {
    console.error(`build-category-rules: ${problems.length} problem(s)\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }

  // 3. Depth = longest path to a root (cycle-safe).
  const depthMemo = new Map<string, number>();
  const depthOf = (tag: string, stack = new Set<string>()): number => {
    const known = depthMemo.get(tag);
    if (known !== undefined) return known;
    if (stack.has(tag)) return 0;
    stack.add(tag);
    let d = 0;
    for (const p of parents.get(tag) ?? []) if (parents.has(p)) d = Math.max(d, depthOf(p, stack) + 1);
    stack.delete(tag);
    depthMemo.set(tag, d);
    return d;
  };

  // 4. Ancestors carrying a rule, nearest first then alphabetical; drop empty non-rule entries.
  const ruleTags = new Set(seen.keys());
  const ancestors: Record<string, string[]> = {};
  for (const tag of parents.keys()) {
    const dist = new Map<string, number>([[tag, 0]]);
    const queue = [tag];
    while (queue.length) {
      const t = queue.shift() as string;
      for (const p of parents.get(t) ?? []) {
        if (!dist.has(p)) {
          dist.set(p, (dist.get(t) as number) + 1);
          queue.push(p);
        }
      }
    }
    const list = [...dist.entries()]
      .filter(([a, d]) => d > 0 && ruleTags.has(a))
      .sort(([a, da], [b, db]) => da - db || (a < b ? -1 : 1))
      .map(([a]) => a);
    if (list.length || ruleTags.has(tag)) ancestors[tag] = list;
  }
  const kept = Object.keys(ancestors);
  const depth: Record<string, number> = {};
  for (const tag of kept) depth[tag] = depthOf(tag);

  // 5. Synonyms from French and English names, ambiguous slugs dropped.
  const synonyms = new Map<string, string | null>();
  for (const tag of kept) {
    const n = names.get(tag) ?? {};
    for (const lang of ['fr', 'en'] as const) {
      if (!n[lang]) continue;
      const s = slugTag(lang, n[lang]);
      if (s === tag || parents.has(s)) continue;
      const prev = synonyms.get(s);
      synonyms.set(s, prev === undefined || prev === tag ? tag : null);
    }
  }
  const ambiguous = [...synonyms.entries()].filter(([, v]) => v === null).map(([k]) => k);
  const synonymObj: Record<string, string> = {};
  for (const [k, v] of synonyms) if (v) synonymObj[k] = v;

  // 6. Version.
  const content = {
    format: 1 as const,
    categories: contractKeys,
    tagRules: { tier0: sortKeys(tagRules.tier0), tier1: sortKeys(tagRules.tier1), tier2: sortKeys(tagRules.tier2) },
    ancestors: sortKeys(ancestors),
    depth: sortKeys(depth),
    synonyms: sortKeys(synonymObj),
    ignoredTags: [...source.ignoredTags].sort(),
    foodGroups: sortKeys(foodGroups),
    pnns2: sortKeys(source.pnns2),
    pnns1: sortKeys(source.pnns1),
    nameRegexes: source.nameRegexes,
    databaseDefaults: sortKeys(source.databaseDefaults),
    finalFallback: source.finalFallback,
  };
  let version = source.version;
  if (existsSync(OUT)) {
    const prev = JSON.parse(readFileSync(OUT, 'utf8')) as CategoryRulesArtefact;
    const { version: pv, builtAt: _b, taxonomies: _t, ...prevContent } = prev;
    const sameTaxonomies = Object.entries(prev.taxonomies).every(
      ([k, v]) => v.sha256 === tax[k as TaxName].meta.sha256,
    );
    const same =
      JSON.stringify(sortKeys(prevContent)) === JSON.stringify(sortKeys(content as Record<string, unknown>)) &&
      sameTaxonomies;
    version = same ? pv : Math.max(pv + 1, source.version);
  }
  if (version !== source.version) {
    const raw = JSON.parse(readFileSync(SOURCE, 'utf8'));
    raw.version = version;
    writeFileSync(SOURCE, `${JSON.stringify(raw, null, 2)}\n`);
  }

  const taxonomies = Object.fromEntries(
    (Object.keys(TAXONOMIES) as TaxName[]).map((k) => [k, tax[k].meta]),
  ) as CategoryRulesArtefact['taxonomies'];
  const artefact = {
    version,
    builtAt: new Date().toISOString(),
    taxonomies,
    ...content,
  } as unknown as CategoryRulesArtefact;
  const text = `${JSON.stringify(sortKeys(artefact as unknown as Record<string, unknown>), null, 1)}\n`;
  if (Buffer.byteLength(text) > MAX_BYTES) {
    console.error(`build-category-rules: artefact is ${Buffer.byteLength(text)} bytes, above ${MAX_BYTES}`);
    process.exit(1);
  }

  // 8. Regression sample: the worked examples of 05 §5.3.
  const sample: Array<[string, string[], string[], string, string]> = [
    ['Nutella', ['en:spreads', 'en:sweet-spreads', 'en:hazelnut-spreads'], [], 'off', 'petit_dej'],
    [
      'Bordeaux rouge',
      ['en:beverages', 'en:alcoholic-beverages', 'en:wines', 'en:red-wines', 'en:bordeaux-wines'],
      [],
      'off',
      'vin',
    ],
    ['Pizza', ['en:frozen-foods', 'en:pizzas', 'en:frozen-pizzas'], [], 'off', 'surgeles'],
    ['Le Chat', ['en:household-chemicals', 'en:liquid-detergent'], [], 'opf', 'entretien'],
    ['Lotus', ['en:household-supplies', 'en:toilet-papers'], [], 'opf', 'papier'],
    ['NESTLE NATURNES BIO Petits Pots', [], [], 'off', 'bebe'],
    ['Dentifrice fraîcheur', ['en:non-food-products', 'en:Dents'], [], 'obf', 'hygiene'],
    ['Liquide vaisselle', ['fr:Liquide vaisselle'], [], 'obf', 'entretien'],
    ['Chocolat', [], ['en:sugary-snacks', 'en:chocolate-products'], 'off', 'chocolat'],
  ];
  let agree = 0;
  for (const [name, cats, groups, src, expected] of sample) {
    const r = mapCategory(
      {
        source: src as 'off',
        categoriesTags: cats,
        foodGroupsTags: groups,
        pnnsGroups1: null,
        pnnsGroups2: null,
        name,
      },
      artefact,
    );
    if (r.categoryKey === expected) agree++;
    else console.warn(`  sample mismatch: ${name} -> ${r.categoryKey} (${r.categoryRule}), expected ${expected}`);
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, text);
  console.log(
    `category rules v${version}: ${ruleTags.size} rule tags, ${kept.length} ancestor entries, ` +
      `${Object.keys(synonymObj).length} synonyms (${ambiguous.length} ambiguous dropped), ` +
      `${Buffer.byteLength(text)} bytes; sample ${agree}/${sample.length}`,
  );
  if (agree < sample.length) process.exit(1);
}

await main();
