/**
 * Catalogue prices: Open Prices dumps -> prices.csv + prices-report.json
 * (docs/architecture/05-catalogue.md §7.3).
 *
 * Price selection reuses the catalog-lookup Edge Function code (§7.2), so a price loaded here and a
 * price fetched live for the same product are chosen the same way.
 *
 * Usage (Node 22.18+ runs TypeScript directly), from the project root:
 *   node scripts/catalogue/refresh-prices.ts [--no-download] [--today YYYY-MM-DD]
 * Input:  https://prices.openfoodfacts.org/data/{prices,locations}.jsonl.gz (ODbL), kept in
 *         scripts/catalogue/out/prices/; --no-download reuses the files already there
 * Output: scripts/catalogue/out/prices.csv (PriceRecord columns, header row) and prices-report.json
 */
import { createReadStream, createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { createGunzip } from 'node:zlib';
import { type PriceObservation, selectPriceWithSample } from '../../supabase/functions/catalog-lookup/prices.ts';
import type { PriceChain } from '../../supabase/functions/catalog-lookup/types.ts';
import { gtinFromCode } from './build-seed.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_DIR = join(ROOT, 'scripts/catalogue/out');
const DUMP_DIR = join(OUT_DIR, 'prices');
const BASE_URL = 'https://prices.openfoodfacts.org/data';
const USER_AGENT = 'Cellier/1.0 (catalogue price refresh)';

export const PRICE_COLUMNS = ['gtin', 'price_cents', 'price_observed_on', 'price_chain', 'sample_size'] as const;

type Location = NonNullable<PriceObservation['location']>;

interface DumpPrice extends PriceObservation {
  product_code?: unknown;
  location_id?: unknown;
}

function flag(name: string): boolean {
  return process.argv.includes(name);
}
function option(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i > 0 ? (process.argv[i + 1] ?? null) : null;
}

async function download(file: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/${file}`, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok || !res.body) throw new Error(`${file}: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(join(DUMP_DIR, file)));
}

async function* jsonLines(path: string): AsyncGenerator<unknown> {
  const rl = createInterface({ input: createReadStream(path).pipe(createGunzip()), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.trim() === '') continue;
    try {
      yield JSON.parse(line);
    } catch {
      // A truncated or malformed line is skipped; the report counts rows read.
    }
  }
}

async function seedGtins(): Promise<Set<string> | null> {
  const path = join(OUT_DIR, 'seed.csv');
  if (!existsSync(path)) return null;
  const gtins = new Set<string>();
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  // Lines continuing a quoted field never start with a quoted 14-digit GTIN followed by a comma.
  for await (const line of rl) {
    const m = /^"([0-9]{14})",/.exec(line);
    if (m) gtins.add(m[1]);
  }
  return gtins;
}

async function main(): Promise<void> {
  const today = option('--today') ?? new Date().toISOString().slice(0, 10);
  mkdirSync(DUMP_DIR, { recursive: true });
  if (!flag('--no-download')) {
    for (const file of ['locations.jsonl.gz', 'prices.jsonl.gz']) await download(file);
  }

  const locations = new Map<number, Location>();
  for await (const row of jsonLines(join(DUMP_DIR, 'locations.jsonl.gz'))) {
    const l = row as Location & { id?: unknown };
    if (typeof l.id !== 'number') continue;
    locations.set(l.id, {
      osm_brand: l.osm_brand,
      osm_name: l.osm_name,
      osm_address_country_code: l.osm_address_country_code,
    });
  }

  let priceRows = 0;
  let badCode = 0;
  const byGtin = new Map<string, PriceObservation[]>();
  for await (const row of jsonLines(join(DUMP_DIR, 'prices.jsonl.gz'))) {
    priceRows++;
    const p = row as DumpPrice;
    if (p.type !== 'PRODUCT' || typeof p.product_code !== 'string') continue;
    const gtin = gtinFromCode(p.product_code);
    if (gtin === null) {
      badCode++;
      continue;
    }
    const obs: PriceObservation = {
      type: p.type,
      price: p.price,
      price_is_discounted: p.price_is_discounted,
      price_per: p.price_per,
      currency: p.currency,
      date: p.date,
      duplicate_of: p.duplicate_of,
      location: typeof p.location_id === 'number' ? (locations.get(p.location_id) ?? null) : null,
    };
    const list = byGtin.get(gtin);
    if (list) list.push(obs);
    else byGtin.set(gtin, [obs]);
  }

  const seed = await seedGtins();
  const byChain: Record<PriceChain, number> = { leclerc: 0, carrefour: 0, other: 0 };
  const byAge = { within90Days: 0, within365Days: 0, older: 0 };
  let inSeed = 0;
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const lines: string[] = [PRICE_COLUMNS.join(',')];
  for (const gtin of [...byGtin.keys()].sort()) {
    const picked = selectPriceWithSample(byGtin.get(gtin) ?? [], today);
    if (picked === null) continue;
    const { choice, sampleSize } = picked;
    lines.push(`${gtin},${choice.priceCents},${choice.priceObservedOn},${choice.priceChain},${sampleSize}`);
    byChain[choice.priceChain]++;
    const age = (todayMs - Date.parse(`${choice.priceObservedOn}T00:00:00Z`)) / 86_400_000;
    if (age <= 90) byAge.within90Days++;
    else if (age <= 365) byAge.within365Days++;
    else byAge.older++;
    if (seed?.has(gtin)) inSeed++;
  }
  writeFileSync(join(OUT_DIR, 'prices.csv'), `${lines.join('\n')}\n`);

  const priced = lines.length - 1;
  const report = {
    builtAt: new Date().toISOString(),
    today,
    input: { locations: locations.size, priceRows, badCode, gtinsWithAnyPrice: byGtin.size },
    gtinsWithPlausiblePrice: priced,
    byChain,
    byAge,
    seed: seed === null ? null : { rows: seed.size, priced: inSeed, share: Number((inSeed / seed.size).toFixed(4)) },
  };
  writeFileSync(join(OUT_DIR, 'prices-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
