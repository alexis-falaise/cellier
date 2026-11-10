/**
 * Accueil «Bientôt épuisé» (design 03 §4.2.3, §3.4): which products, in which order, with which badge.
 * Pure; the forecasts come from `useHouseholdForecasts`.
 */
import type { ProductForecast } from '@/features/forecast';
import { compareFr, formatCover, formatCoverA11y, t } from '@/shared/i18n';

export type LowBadge = { kind: 'out' } | { kind: 'cover'; days: number } | { kind: 'threshold' };

export interface LowRowModel {
  productId: string;
  name: string;
  totalQuantity: number;
  badge: LowBadge;
}

/** A forecast the badge may show as a day count: ≥ medium confidence (§3.4 honesty rules). */
export function hasUsableForecast(f: ProductForecast): f is ProductForecast & { daysLeft: number } {
  return f.daysLeft !== null && f.runOut !== null && f.confidence !== 'low';
}

export function lowBadge(f: ProductForecast): LowBadge {
  if (f.totalQuantity <= 0) return { kind: 'out' };
  if (hasUsableForecast(f)) return { kind: 'cover', days: f.daysLeft };
  return { kind: 'threshold' };
}

export function lowBadgeText(badge: LowBadge): { label: string; accessibleLabel: string } {
  switch (badge.kind) {
    case 'out':
      return { label: t('forecast.badge.out'), accessibleLabel: t('forecast.badge.out') };
    case 'cover':
      return { label: formatCover(badge.days), accessibleLabel: formatCoverA11y(badge.days) };
    default:
      return { label: t('forecast.badge.threshold'), accessibleLabel: t('a11y.forecast.threshold') };
  }
}

function group(f: ProductForecast): number {
  if (f.totalQuantity <= 0) return 0;
  return hasUsableForecast(f) ? 1 : 2;
}

/**
 * Running-low products, most urgent first: (1) at 0, by name; (2) with a usable forecast, by days of
 * cover; (3) low by seuil only, by stock / seuil, then name. `include` narrows to one cellier.
 */
export function runningLowRows(
  forecasts: readonly ProductForecast[],
  names: ReadonlyMap<string, string>,
  include: (productId: string) => boolean = () => true,
): LowRowModel[] {
  const low = forecasts.filter((f) => f.runningLow && !f.deleted && include(f.productId));
  low.sort((a, b) => {
    const ga = group(a);
    const gb = group(b);
    if (ga !== gb) return ga - gb;
    const nameOrder = compareFr(names.get(a.productId) ?? '', names.get(b.productId) ?? '');
    if (ga === 1) return (a.daysLeft ?? 0) - (b.daysLeft ?? 0) || nameOrder;
    if (ga === 2) {
      const ra = a.totalQuantity / Math.max(1, a.minimum);
      const rb = b.totalQuantity / Math.max(1, b.minimum);
      return ra - rb || nameOrder;
    }
    return nameOrder;
  });
  return low.map((f) => ({
    productId: f.productId,
    name: names.get(f.productId) ?? '',
    totalQuantity: f.totalQuantity,
    badge: lowBadge(f),
  }));
}

/** «À surveiller» when nothing is low: the product with the smallest usable forecast cover. */
export function nextToWatch(
  forecasts: readonly ProductForecast[],
  names: ReadonlyMap<string, string>,
): { name: string; days: number } | null {
  let best: (ProductForecast & { daysLeft: number }) | null = null;
  for (const f of forecasts) {
    if (f.deleted || !f.lowAlert || f.runningLow || f.totalQuantity <= 0 || !hasUsableForecast(f)) continue;
    if (!best || f.daysLeft < best.daysLeft) best = f;
  }
  return best ? { name: names.get(best.productId) ?? '', days: Math.max(1, Math.round(best.daysLeft)) } : null;
}

/** Number shown on the app icon (§2.5 of 04): running-low products of the household. */
export function runningLowCount(forecasts: readonly ProductForecast[]): number {
  let n = 0;
  for (const f of forecasts) if (f.runningLow && !f.deleted) n += 1;
  return n;
}
