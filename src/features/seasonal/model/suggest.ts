/**
 * Seasonal suggestions for the Courses list, on top of the running-low and habit suggestions.
 * Pure: the month and every input are arguments.
 *
 * 1. Swaps: a listed food that is out of season (or a year-round import with a swap) gets one
 *    in-season replacement, preferring foods the household already buys.
 * 2. Back in season: foods the household bought in an earlier season, out of stock, now in season.
 * 3. Starting: foods whose season starts this month, lowest footprint first.
 * Foods on the list, in stock (for 2 and 3) or dismissed this month are never suggested.
 */
import type { ProductId } from '@/domain/types';
import { FOODS_BY_SLUG, SEASONAL_FOODS, SWAPS } from './catalog';
import type { KnownFood, ListedFood, SeasonalEntry, SeasonalSuggestion } from './types';

export const MAX_BACK = 3;
export const MAX_STARTING = 3;
/** Back-in-season and starting suggestions together; swaps are bounded by the list itself. */
export const MAX_EXTRAS = 4;

/** Calendar month as a running index (year × 12 + month − 1), so seasons can wrap across years. */
export type MonthIndex = number;

export const monthIndex = (year: number, month: number): MonthIndex => year * 12 + (month - 1);
const monthOf = (i: MonthIndex) => (((i % 12) + 12) % 12) + 1;

export const inSeason = (e: SeasonalEntry, month: number) => e.months.includes(month);
/** Available every month: an import or a greenhouse crop, not a seasonal food. */
export const isYearRound = (e: SeasonalEntry) => e.months.length >= 12;
const seasonal = (e: SeasonalEntry, month: number) => inSeason(e, month) && !isYearRound(e);

/** First month of the season run containing `now` (null when not in season). */
export function seasonStart(e: SeasonalEntry, now: MonthIndex): MonthIndex | null {
  if (!seasonal(e, monthOf(now))) return null;
  let start = now;
  while (inSeason(e, monthOf(start - 1))) start--;
  return start;
}

export interface SeasonalInput {
  /** Current month (Paris time). */
  now: MonthIndex;
  /** Rows to buy and rows in the cart. */
  listed: readonly ListedFood[];
  known: readonly KnownFood[];
  /** Slugs dismissed this month. */
  dismissed: ReadonlySet<string>;
  /** Month of a purchase time (Paris time). */
  monthOfTime: (t: number) => MonthIndex;
}

export function seasonalSuggestions(input: SeasonalInput): SeasonalSuggestion[] {
  const month = monthOf(input.now);
  const taken = new Set<string>(input.dismissed);
  for (const l of input.listed) if (l.slug) taken.add(l.slug);

  const knownBySlug = new Map<string, KnownFood[]>();
  for (const k of input.known) {
    const list = knownBySlug.get(k.slug);
    if (list) list.push(k);
    else knownBySlug.set(k.slug, [k]);
  }
  const inStock = (slug: string) => knownBySlug.get(slug)?.some((k) => k.inStock) ?? false;
  const lastBought = (slug: string) =>
    (knownBySlug.get(slug) ?? []).reduce<number | null>(
      (t, k) => (k.lastBoughtAt !== null && (t === null || k.lastBoughtAt > t) ? k.lastBoughtAt : t),
      null,
    );
  /** The household product to link: the most recently bought one of this food. */
  const productFor = (slug: string): ProductId | null => {
    const list = knownBySlug.get(slug);
    if (!list || list.length === 0) return null;
    return list.reduce((best, k) => ((k.lastBoughtAt ?? -1) > (best.lastBoughtAt ?? -1) ? k : best)).productId;
  };
  const suggestion = (e: SeasonalEntry, rest: Pick<SeasonalSuggestion, 'reason' | 'replaces'>): SeasonalSuggestion => {
    taken.add(e.slug);
    return { slug: e.slug, name: e.name, productId: productFor(e.slug), ...rest };
  };

  const out: SeasonalSuggestion[] = [];

  for (const l of input.listed) {
    if (l.checked || !l.slug) continue;
    const food = FOODS_BY_SLUG.get(l.slug);
    const options = SWAPS[l.slug];
    if (!food || !options) continue;
    const outOfSeason = !inSeason(food, month);
    if (!outOfSeason && !isYearRound(food)) continue;
    // Foods the household already buys first; the curated order otherwise (stable sort).
    const ranked = [...options].sort((a, b) => Number(knownBySlug.has(b)) - Number(knownBySlug.has(a)));
    const pick = ranked
      .map((slug) => FOODS_BY_SLUG.get(slug))
      .find((e): e is SeasonalEntry => e !== undefined && !taken.has(e.slug) && seasonal(e, month));
    if (!pick) continue;
    out.push(
      suggestion(pick, {
        reason: 'swap',
        replaces: { ref: l.ref, name: l.name, why: outOfSeason ? 'out-of-season' : 'imported' },
      }),
    );
  }

  const extras: SeasonalSuggestion[] = [];
  const back = [...knownBySlug.keys()]
    .map((slug) => ({ e: FOODS_BY_SLUG.get(slug), at: lastBought(slug) }))
    .filter((x): x is { e: SeasonalEntry; at: number } => {
      if (!x.e || x.at === null || taken.has(x.e.slug) || inStock(x.e.slug) || x.e.group === 'herbes') return false;
      const start = seasonStart(x.e, input.now);
      return start !== null && input.monthOfTime(x.at) < start;
    })
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_BACK);
  for (const { e } of back) extras.push(suggestion(e, { reason: 'back', replaces: null }));

  const starting = SEASONAL_FOODS.filter(
    (e) =>
      e.group !== 'herbes' &&
      !taken.has(e.slug) &&
      !inStock(e.slug) &&
      seasonal(e, month) &&
      !inSeason(e, monthOf(input.now - 1)),
  )
    .sort((a, b) => (a.kgCo2e ?? Number.POSITIVE_INFINITY) - (b.kgCo2e ?? Number.POSITIVE_INFINITY))
    .slice(0, MAX_STARTING);
  for (const e of starting) {
    if (extras.length >= MAX_EXTRAS) break;
    extras.push(suggestion(e, { reason: 'starting', replaces: null }));
  }

  return [...out, ...extras];
}
