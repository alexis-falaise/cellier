/**
 * Purchase prices. A product's price history is its priced restocks (receipt lines, priced put-aways)
 * that were not reverted; nothing else is stored. The typical price is the median or the average,
 * whichever describes the purchases better:
 *
 * - one purchase: that price;
 * - two purchases: the average (the median of two values is the same number);
 * - three or more: the average, unless a few unusual purchases (a promotion, a different shop, a
 *   one-off) pull it away from the median by more than 5 %, or one purchase is far from the others
 *   (more than 3 × the median absolute deviation and 20 % from the median). Then the median, which
 *   ignores those outliers.
 */
import type { Movement, ProductId } from '@/domain/types';
import { normalizeName } from '@/shared/sync/util';

export interface PricePoint {
  movementId: string;
  priceCents: number;
  quantity: number;
  at: string;
  store: string | null;
  receiptLabel: string | null;
  pending: boolean;
}

export type PriceMeasure = 'single' | 'mean' | 'median';

export interface PriceStats {
  count: number;
  /** The figure to show: median or average per `measure`. */
  typicalCents: number;
  measure: PriceMeasure;
  meanCents: number;
  medianCents: number;
  minCents: number;
  maxCents: number;
  latest: PricePoint;
}

/** Above this gap between the average and the median, the median is shown. */
export const SKEW_THRESHOLD = 0.05;
const OUTLIER_MADS = 3;
const OUTLIER_MIN_GAP = 0.2;

type PricedMovement = Pick<
  Movement,
  'id' | 'kind' | 'productId' | 'appliedDelta' | 'requestedDelta' | 'revertsId' | 'createdAt' | 'seq'
> &
  Partial<Pick<Movement, 'priceCents' | 'store' | 'receiptLabel'>>;

/** Ids of movements undone by a correction. */
function revertedIds(movements: Iterable<PricedMovement>): Set<string> {
  const out = new Set<string>();
  for (const m of movements) if (m.kind === 'correction' && m.revertsId) out.add(m.revertsId);
  return out;
}

/** Priced, non-reverted restocks of one product, oldest first. */
export function pricePoints(movements: readonly PricedMovement[], productId: ProductId | string): PricePoint[] {
  const reverted = revertedIds(movements);
  return movements
    .filter((m) => m.productId === productId && m.kind === 'restock' && m.priceCents != null && !reverted.has(m.id))
    .map((m) => ({
      movementId: m.id,
      priceCents: m.priceCents as number,
      quantity: Math.max(1, m.requestedDelta),
      at: m.createdAt,
      store: m.store ?? null,
      receiptLabel: m.receiptLabel ?? null,
      pending: m.seq === Number.POSITIVE_INFINITY,
    }))
    .sort((a, b) => a.at.localeCompare(b.at) || a.movementId.localeCompare(b.movementId));
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/** Whether the median describes these prices better than the average. */
export function prefersMedian(prices: readonly number[]): boolean {
  if (prices.length < 3) return false;
  const med = median(prices);
  if (med <= 0) return false;
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
  if (Math.abs(mean - med) / med > SKEW_THRESHOLD) return true;
  const mad = median(prices.map((p) => Math.abs(p - med)));
  return prices.some((p) => {
    const gap = Math.abs(p - med);
    return gap > OUTLIER_MADS * mad && gap / med > OUTLIER_MIN_GAP;
  });
}

/** Statistics of a price history (oldest first), or null when there is none. */
export function priceStats(points: readonly PricePoint[]): PriceStats | null {
  const latest = points.at(-1);
  if (!latest) return null;
  const prices = points.map((p) => p.priceCents);
  const meanCents = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
  const medianCents = Math.round(median(prices));
  const measure: PriceMeasure = prices.length === 1 ? 'single' : prefersMedian(prices) ? 'median' : 'mean';
  return {
    count: prices.length,
    typicalCents: measure === 'median' ? medianCents : measure === 'mean' ? meanCents : latest.priceCents,
    measure,
    meanCents,
    medianCents,
    minCents: Math.min(...prices),
    maxCents: Math.max(...prices),
    latest,
  };
}

/** Normalised receipt label, the key of the label → product memory. */
export const labelKey = (label: string): string => normalizeName(label);

/**
 * Receipt labels already matched to a product, from the household's receipt restocks: the most
 * recent match of a label wins (a member who re-assigned a label is followed). Reverted lines and
 * products no longer live are left out.
 */
export function receiptLabelMemory(
  movements: readonly PricedMovement[],
  isLiveProduct: (productId: string) => boolean,
): Map<string, ProductId> {
  const reverted = revertedIds(movements);
  const latest = new Map<string, { productId: ProductId; at: string }>();
  for (const m of movements) {
    if (m.kind !== 'restock' || !m.receiptLabel || reverted.has(m.id) || !isLiveProduct(m.productId)) continue;
    const key = labelKey(m.receiptLabel);
    if (!key) continue;
    const prev = latest.get(key);
    if (!prev || m.createdAt > prev.at) latest.set(key, { productId: m.productId, at: m.createdAt });
  }
  return new Map([...latest].map(([k, v]) => [k, v.productId]));
}
