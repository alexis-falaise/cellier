/**
 * Catalogue seed, step 3: candidates.jsonl -> seed.csv + seed-report.json
 * (docs/architecture/05-catalogue.md §10.2 step 4).
 *
 * Normalisation, category mapping and retailer tags reuse the catalog-lookup Edge Function code, so a
 * seeded row and a row fetched live for the same product are identical.
 *
 * Usage (Node 22.18+ runs TypeScript directly), from the project root:
 *   node scripts/catalogue/build-seed.ts [--in file.jsonl] [--target 130000] [--max-rows 150000] [--max-nonfood 30000]
 * Input:  scripts/catalogue/out/candidates.jsonl (extract.sh)
 * Output: scripts/catalogue/out/seed.csv (columns of public.catalog_products, header row) and seed-report.json
 */
import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { computeCheckDigit, isVariableMeasure } from '../../supabase/functions/catalog-lookup/gtin.ts';
import { normalise } from '../../supabase/functions/catalog-lookup/normalise.ts';
import { storeTags } from '../../supabase/functions/catalog-lookup/retailers.ts';
import type {
  CatalogProduct,
  CategoryRulesArtefact,
  OffRecord,
  UpstreamSource,
} from '../../supabase/functions/catalog-lookup/types.ts';
import { CATEGORY_KEYS } from '../../supabase/functions/catalog-lookup/types.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_DIR = join(ROOT, 'scripts/catalogue/out');
const RULES = join(ROOT, 'supabase/functions/_shared/catalogue/category-rules.json');

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(name);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
}
const HARD_CAP = 150_000;
const TARGET = Math.min(arg('--target', 130_000), arg('--max-rows', HARD_CAP), HARD_CAP);
const MAX_NONFOOD = arg('--max-nonfood', 30_000);

/** Columns of public.catalog_products written by the seed, in CSV order (search_text and timestamps excluded). */
export const SEED_COLUMNS = [
  'gtin',
  'name',
  'brand',
  'quantity_label',
  'net_quantity',
  'net_unit',
  'pack_count',
  'category_key',
  'category_rule',
  'category_tags',
  'image_url',
  'source',
  'store_tags',
  'popularity',
  'price_cents',
  'price_observed_on',
  'price_chain',
  'source_modified_at',
] as const;

const IMAGE_HOST: Record<UpstreamSource, string> = {
  off: 'images.openfoodfacts.org',
  obf: 'images.openbeautyfacts.org',
  opf: 'images.openproductsfacts.org',
  opff: 'images.openpetfoodfacts.org',
};

const WEIGHT: Record<string, number> = {};
for (const k of [
  'conserves',
  'feculents',
  'epicerie_sucree',
  'petit_dej',
  'cafe',
  'condiments',
  'chocolat',
  'apero',
  'soft',
  'jus',
  'eau',
  'vin',
  'biere',
  'surgeles',
  'bebe',
  'animaux',
  'entretien',
  'hygiene',
  'papier',
  'pharmacie',
]) {
  WEIGHT[k] = 1.0;
}
for (const k of ['laitier', 'plats', 'pain', 'viande', 'poisson', 'autre']) WEIGHT[k] = 0.6;
for (const k of ['legumes', 'fruits']) WEIGHT[k] = 0.3;

interface Candidate {
  source: UpstreamSource;
  code: string;
  name_fr: string | null;
  name_lang: string | null;
  name_any: string | null;
  generic_fr: string | null;
  generic_any: string | null;
  brands: string | null;
  brands_tags: string[] | null;
  stores_tags: string[] | null;
  categories_tags: string[] | null;
  food_groups_tags: string[] | null;
  quantity: string | null;
  product_quantity: string | null;
  product_quantity_unit: string | null;
  front_key: string | null;
  front_rev: number | null;
  unique_scans_n: number | null;
  last_modified_t: number | null;
}

interface Scored {
  product: CatalogProduct;
  categoryTags: string[];
  score: number;
  quantityParsed: boolean;
}

/** Dump code -> canonical GTIN-14, or null (bad length, bad check digit, restricted circulation, all zeros). */
export function gtinFromCode(code: string): string | null {
  if (!/^[0-9]{8,14}$/.test(code)) return null;
  const g = code.padStart(14, '0');
  if (/^0+$/.test(g)) return null;
  if (computeCheckDigit(g.slice(0, 13)) !== Number(g[13])) return null;
  // Binding rule (05 §3.2 step 6): 13-digit form starting 02 or 2x when the indicator digit is 0.
  if (g[0] === '0' && isVariableMeasure(g.slice(1))) return null;
  return g;
}

/** 05 §4.5, seed path. */
export function imageUrl(source: UpstreamSource, code: string, key: string | null, rev: number | null): string | null {
  if (!key || !rev || !/^front_[a-z]{2,3}$/.test(key)) return null;
  let folder = code;
  if (code.length > 8) {
    const c = code.padStart(13, '0');
    folder = `${c.slice(0, 3)}/${c.slice(3, 6)}/${c.slice(6, 9)}/${c.slice(9)}`;
  }
  return `https://${IMAGE_HOST[source]}/images/products/${folder}/${key}.${rev}.200.jpg`;
}

function toRecord(c: Candidate): OffRecord {
  return {
    code: c.code,
    product_name_fr: c.name_fr,
    product_name: c.name_lang ?? c.name_any,
    generic_name_fr: c.generic_fr,
    generic_name: c.generic_any,
    brands: c.brands,
    brands_tags: c.brands_tags ?? [],
    stores_tags: c.stores_tags ?? [],
    categories_tags: c.categories_tags ?? [],
    food_groups_tags: c.food_groups_tags ?? [],
    quantity: c.quantity,
    product_quantity: c.product_quantity,
    product_quantity_unit: c.product_quantity_unit,
    unique_scans_n: c.unique_scans_n ?? 0,
    last_modified_t: c.last_modified_t,
    image_front_small_url: imageUrl(c.source, c.code, c.front_key, c.front_rev),
  } as OffRecord;
}

// ---- CSV ----
const csvText = (v: string | null) => (v === null ? '' : `"${v.replace(/"/g, '""')}"`);
const pgArray = (a: string[]) => `{${a.map((x) => `"${x.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}`;
const csvNum = (v: number | null) => (v === null ? '' : String(v));

export function csvLine(p: CatalogProduct, categoryTags: string[]): string {
  return [
    csvText(p.gtin),
    csvText(p.name),
    csvText(p.brand),
    csvText(p.quantityLabel),
    csvNum(p.netQuantity),
    csvText(p.netUnit),
    csvNum(p.packCount),
    csvText(p.categoryKey),
    csvText(p.categoryRule),
    csvText(pgArray(categoryTags)),
    csvText(p.imageUrl),
    csvText(p.source),
    csvText(pgArray(p.storeTags)),
    csvNum(p.popularity),
    csvNum(p.priceCents),
    csvText(p.priceObservedOn),
    csvText(p.priceChain),
    csvText(p.sourceModifiedAt),
  ].join(',');
}

/** The check constraints of public.catalog_products (migration 20261110120200), row by row. */
export function schemaViolations(p: CatalogProduct, categoryTags: string[]): string[] {
  const v: string[] = [];
  const len = (x: string | null) => (x === null ? 0 : [...x].length);
  if (!/^[0-9]{14}$/.test(p.gtin)) v.push('gtin');
  if (len(p.name) < 1 || len(p.name) > 200) v.push('name length');
  if (len(p.brand) > 120) v.push('brand length');
  if (len(p.quantityLabel) > 60) v.push('quantity_label length');
  if (p.netQuantity !== null && !(p.netQuantity > 0 && p.netQuantity < 1e9)) v.push('net_quantity');
  if (p.netUnit !== null && !['g', 'ml', 'piece'].includes(p.netUnit)) v.push('net_unit');
  if (p.packCount !== null && !(Number.isInteger(p.packCount) && p.packCount >= 1 && p.packCount <= 999))
    v.push('pack_count');
  if (p.categoryKey !== null && !(CATEGORY_KEYS as readonly string[]).includes(p.categoryKey)) v.push('category_key');
  if (len(p.categoryRule) > 120) v.push('category_rule length');
  if (len(p.imageUrl) > 500) v.push('image_url length');
  if (!['off', 'obf', 'opf', 'opff'].includes(p.source)) v.push('source');
  if (!Number.isInteger(p.popularity) || p.popularity < 0 || p.popularity > 2_147_483_647) v.push('popularity');
  // COPY cannot carry a NUL character.
  if (categoryTags.some((t) => t.includes('\0'))) v.push('category_tags NUL');
  if (`${p.name}${p.brand ?? ''}${p.quantityLabel ?? ''}`.includes('\0')) v.push('NUL character');
  return v;
}

async function main() {
  const rules = JSON.parse(readFileSync(RULES, 'utf8')) as CategoryRulesArtefact;
  const best = new Map<string, Scored>();
  const counts = { candidates: 0, badCode: 0, noName: 0, nonfoodOther: 0, duplicates: 0 };

  const inIdx = process.argv.indexOf('--in');
  const input = inIdx > 0 ? process.argv[inIdx + 1] : join(OUT_DIR, 'candidates.jsonl');
  const rl = createInterface({ input: createReadStream(input), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    counts.candidates++;
    const c = JSON.parse(line) as Candidate;
    const gtin = gtinFromCode(c.code);
    if (!gtin) {
      counts.badCode++;
      continue;
    }
    const n = normalise(toRecord(c), c.source, gtin, rules);
    if (!n.ok) {
      counts.noName++;
      continue;
    }
    const p = n.product;
    // Open Products Facts also holds electronics, toys, clothes...: keep only what maps to a pantry category.
    if (c.source === 'opf' && p.categoryKey === 'autre') {
      counts.nonfoodOther++;
      continue;
    }
    const ownBrand = storeTags({ storesTags: [], brandsTags: c.brands_tags ?? [], brandless: false, gtin }).length > 0;
    const quantityParsed = p.netQuantity !== null;
    const score =
      (Math.log10(1 + p.popularity) + (p.storeTags.length ? 1.5 : 0) + (ownBrand ? 1.0 : 0)) *
        (WEIGHT[p.categoryKey ?? 'autre'] ?? 0.6) -
      (quantityParsed ? 0 : 0.3);
    const prev = best.get(gtin);
    if (prev) counts.duplicates++;
    if (!prev || score > prev.score)
      best.set(gtin, { product: p, categoryTags: n.categoryTags, score, quantityParsed });
  }

  // Selection: non-food capped first, then the best rows overall.
  const all = [...best.values()].sort((a, b) => b.score - a.score || (a.product.gtin < b.product.gtin ? -1 : 1));
  let nonfood = 0;
  const selected: Scored[] = [];
  for (const s of all) {
    if (selected.length >= TARGET) break;
    if (s.product.source !== 'off') {
      if (nonfood >= MAX_NONFOOD) continue;
      nonfood++;
    }
    selected.push(s);
  }

  // Write CSV (sorted by gtin for stable diffs and a faster primary key build).
  selected.sort((a, b) => (a.product.gtin < b.product.gtin ? -1 : 1));
  const lines = [SEED_COLUMNS.join(','), ...selected.map((s) => csvLine(s.product, s.categoryTags))];
  const csv = `${lines.join('\n')}\n`;
  writeFileSync(join(OUT_DIR, 'seed.csv'), csv);

  // ---- Report and checks ----
  const tally = (f: (s: Scored) => string) => {
    const m: Record<string, number> = {};
    for (const s of selected) m[f(s)] = (m[f(s)] ?? 0) + 1;
    return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]));
  };
  const rows = selected.length;
  const byCategory = tally((s) => s.product.categoryKey ?? 'null');
  const share = Object.fromEntries(
    Object.entries(byCategory).map(([k, v]) => [k, Number(((100 * v) / rows).toFixed(2))]),
  );
  const food = selected.filter((s) => s.product.source === 'off');
  const qtyShareFood = food.filter((s) => s.quantityParsed).length / Math.max(food.length, 1);
  const autreShare = (byCategory.autre ?? 0) / rows;
  const csvBytes = Buffer.byteLength(csv);
  // Size projection (05 §10.3): data bytes from the CSV, plus tuple overhead (32), three timestamps (24),
  // search_text (about name + brand), primary key (40), trigram index (200, middle of 150-250), category index (10).
  const avgName = selected.reduce((t, s) => t + s.product.name.length + (s.product.brand?.length ?? 0) + 1, 0) / rows;
  const bytesPerRow = Math.round(csvBytes / rows + 32 + 24 + avgName + 40 + 200 + 10);
  const projectedMb = Number(((bytesPerRow * rows) / 1e6).toFixed(1));

  const gtins = new Set(selected.map((s) => s.product.gtin));
  const violations = selected.flatMap((s) =>
    schemaViolations(s.product, s.categoryTags).map((v) => `${s.product.gtin}: ${v}`),
  );
  if (violations.length) console.error(`schema violations (first 20):\n  ${violations.slice(0, 20).join('\n  ')}`);
  const keys = new Set<string>(CATEGORY_KEYS);
  const checks = {
    rowsBetween100kAnd150k: rows >= 100_000 && rows <= HARD_CAP,
    gtinsUnique: gtins.size === rows,
    gtinsValid: selected.every((s) => gtinFromCode(s.product.gtin) === s.product.gtin),
    categoriesKnown: selected.every((s) => s.product.categoryKey !== null && keys.has(s.product.categoryKey)),
    autreBelow15pct: autreShare < 0.15,
    nonfoodAtMost30k: nonfood <= MAX_NONFOOD,
    projectedBelow150Mb: projectedMb < 150,
    tableConstraintsHold: violations.length === 0,
  };
  const warnings: string[] = [];
  if (autreShare > 0.1) warnings.push(`autre share ${(100 * autreShare).toFixed(1)} % is above 10 %`);
  if (qtyShareFood < 0.6)
    warnings.push(`quantity parsed on ${(100 * qtyShareFood).toFixed(1)} % of food rows (< 60 %)`);

  const report = {
    builtAt: new Date().toISOString(),
    rulesVersion: rules.version,
    input: counts,
    uniqueValidGtins: best.size,
    rows,
    target: TARGET,
    nonfoodRows: nonfood,
    scoreThreshold: Number(selected.reduce((m, s) => Math.min(m, s.score), Infinity).toFixed(3)),
    bySource: tally((s) => s.product.source),
    byCategory,
    categorySharePct: share,
    autreSharePct: Number((100 * autreShare).toFixed(2)),
    byCategoryRuleKind: tally((s) => (s.product.categoryRule ?? '').split('|')[1]?.split(':')[0] ?? 'none'),
    storeTags: {
      leclerc: selected.filter((s) => s.product.storeTags.includes('leclerc')).length,
      carrefour: selected.filter((s) => s.product.storeTags.includes('carrefour')).length,
    },
    quantityParsedPctFood: Number((100 * qtyShareFood).toFixed(1)),
    withImagePct: Number(((100 * selected.filter((s) => s.product.imageUrl).length) / rows).toFixed(1)),
    csvBytes,
    estimatedBytesPerRow: bytesPerRow,
    projectedTableMb: projectedMb,
    checks,
    warnings,
  };
  writeFileSync(join(OUT_DIR, 'seed-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (!Object.values(checks).every(Boolean)) {
    console.error('build-seed: a check failed (see "checks" above)');
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
