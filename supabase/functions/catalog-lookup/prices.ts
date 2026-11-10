/** Open Prices: plausible price selection (section 7.2) and the on-demand call (section 7.4). */
import { fold } from './retailers.ts';
import { PRICE_DISPLAY_MAX_AGE_DAYS, PRICE_INGEST_MAX_AGE_DAYS, type PriceChain } from './types.ts';

export interface PriceChoice {
  priceCents: number;
  priceObservedOn: string; // YYYY-MM-DD
  priceChain: PriceChain;
}

/** One Open Prices API item (only the fields used). Dump rows have the same names. */
export interface PriceObservation {
  type?: unknown;
  price?: unknown;
  price_is_discounted?: unknown;
  price_per?: unknown;
  currency?: unknown;
  date?: unknown;
  duplicate_of?: unknown;
  location?: {
    osm_brand?: unknown;
    osm_name?: unknown;
    osm_address_country_code?: unknown;
  } | null;
}

interface Obs {
  price: number;
  date: string;
  ageDays: number;
  chain: PriceChain;
}

const DAY_MS = 86_400_000;

function dayNumber(isoDate: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const t = Date.parse(`${isoDate}T00:00:00Z`);
  return Number.isNaN(t) ? null : Math.floor(t / DAY_MS);
}

export function chainOf(location: PriceObservation['location']): PriceChain {
  const text = fold(`${typeof location?.osm_brand === 'string' ? location.osm_brand : ''} ${
    typeof location?.osm_name === 'string' ? location.osm_name : ''
  }`);
  if (text.includes('leclerc')) return 'leclerc';
  if (text.includes('carrefour')) return 'carrefour';
  return 'other';
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const CHAIN_RANK: Record<PriceChain, number> = { leclerc: 0, carrefour: 1, other: 2 };

/** Pure. `today` is a YYYY-MM-DD date (UTC). */
export function selectPrice(items: PriceObservation[], today: string): PriceChoice | null {
  const todayN = dayNumber(today);
  if (todayN === null) return null;

  // 1-2. Filters and absolute bounds.
  let obs: Obs[] = [];
  for (const it of items) {
    if (it.type !== 'PRODUCT' || it.currency !== 'EUR') continue;
    if (it.price_is_discounted !== false) continue;
    if (it.duplicate_of !== null && it.duplicate_of !== undefined) continue;
    if (it.price_per !== null && it.price_per !== undefined && it.price_per !== 'UNIT') continue;
    const country = it.location?.osm_address_country_code;
    if (typeof country !== 'string' || country.toUpperCase() !== 'FR') continue;
    if (typeof it.date !== 'string') continue;
    const d = dayNumber(it.date);
    if (d === null || d > todayN || todayN - d > PRICE_INGEST_MAX_AGE_DAYS) continue;
    const price = typeof it.price === 'number' ? it.price : typeof it.price === 'string' ? Number(it.price) : NaN;
    if (!Number.isFinite(price) || price < 0.05 || price > 500) continue;
    obs.push({ price, date: it.date, ageDays: todayN - d, chain: chainOf(it.location) });
  }
  if (obs.length === 0) return null;

  // 3. Outliers.
  let ref: number;
  if (obs.length >= 3) {
    const recent = obs.filter((o) => o.ageDays <= 365);
    ref = median((recent.length >= 3 ? recent : obs).map((o) => o.price));
    obs = obs.filter((o) => o.price >= ref / 3 && o.price <= ref * 3);
    if (obs.length === 0) return null;
  } else {
    if (obs.length === 1 && obs[0].ageDays > PRICE_DISPLAY_MAX_AGE_DAYS) return null;
    ref = median(obs.map((o) => o.price));
  }

  // 5. Most recent; within 7 days of it prefer leclerc, carrefour, other, then closest to the median.
  const newest = Math.min(...obs.map((o) => o.ageDays));
  const window = obs.filter((o) => o.ageDays - newest <= 7);
  window.sort((a, b) =>
    CHAIN_RANK[a.chain] - CHAIN_RANK[b.chain] ||
    Math.abs(a.price - ref) - Math.abs(b.price - ref) ||
    a.ageDays - b.ageDays
  );
  const best = window[0];
  return { priceCents: Math.round(best.price * 100), priceObservedOn: best.date, priceChain: best.chain };
}

export function pricesUrl(offCode: string): string {
  return `https://prices.openfoodfacts.org/api/v1/prices?product_code=${encodeURIComponent(offCode)}` +
    '&currency=EUR&price_is_discounted=false&duplicate_of__isnull=true&order_by=-created&size=50';
}

/** Never throws; null on any failure or timeout. */
export async function fetchPrice(
  offCode: string,
  userAgent: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<PriceChoice | null> {
  try {
    const timeout = AbortSignal.timeout(timeoutMs);
    const res = await fetch(pricesUrl(offCode), {
      headers: { 'User-Agent': userAgent, Accept: 'application/json' },
      signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
    });
    if (!res.ok) {
      await res.body?.cancel();
      return null;
    }
    const body = await res.json();
    const items = Array.isArray(body?.items) ? (body.items as PriceObservation[]) : [];
    return selectPrice(items, new Date().toISOString().slice(0, 10));
  } catch {
    return null;
  }
}
