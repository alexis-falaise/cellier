/**
 * Running low per kind (05-catalogue.md §5.8, mirrors private.evaluate_low_stock).
 *
 * Products of one kind are interchangeable: four ground coffees from different origins are one
 * «café moulu». The kind is low when the household total of its products is at or below its seuil,
 * not when one of them is empty. The kind's forecast is carried by one representative product (the
 * most recently restocked), so grocery rows, dismissals and «Ranger» keep working on a product id;
 * the other members are never low on their own.
 *
 * Seuil of a kind: the largest `minQuantity` a member set, else the largest suggested seuil, else
 * the largest default minimum of its products.
 */
import type { Product, ProductId } from '@/domain/types';
import { normalizeName } from '@/shared/sync/util';
import { DEFAULT_FORECAST_CONFIG } from './config';
import { runOutBand } from './rate';
import { clearLevel } from './threshold';
import { DAY_MS } from './time';
import type { EpochMs, ForecastConfig, ProductForecast, RateEstimate, RunningLowReason } from './types';

export type KindProduct = Pick<Product, 'id' | 'kind' | 'minQuantity' | 'suggestedMin' | 'deletedAt'>;

export interface KindGroup {
  /** The kind as written on the representative. */
  label: string;
  representative: ProductId;
  members: readonly ProductId[];
}

export interface KindMerge {
  /** One forecast per product; members of a multi-product kind are folded into the representative. */
  forecasts: ProductForecast[];
  /** Kind of each product that belongs to a multi-product kind. */
  groups: ReadonlyMap<ProductId, KindGroup>;
}

function combinedRate(rates: readonly RateEstimate[]): RateEstimate | null {
  if (rates.length === 0) return null;
  let asOf = 0;
  const sum = { ratePerDay: 0, rawRate: 0, shape: 0, exposureDays: 0, weightedQuantity: 0, events: 0 };
  for (const r of rates) {
    sum.ratePerDay += r.ratePerDay;
    sum.rawRate += r.rawRate;
    sum.shape += r.shape;
    sum.exposureDays = Math.max(sum.exposureDays, r.exposureDays);
    sum.weightedQuantity += r.weightedQuantity;
    sum.events += r.events;
    asOf = Math.max(asOf, r.asOf);
  }
  return { ...sum, asOf };
}

function foldKind(
  members: readonly ProductForecast[],
  products: ReadonlyMap<string, KindProduct>,
  now: EpochMs,
  cfg: ForecastConfig,
): ProductForecast {
  const rep = members.reduce((best, f) => ((f.lastRestockAt ?? -1) > (best.lastRestockAt ?? -1) ? f : best));
  const total = members.reduce((n, f) => n + f.totalQuantity, 0);
  const userMins = members.map((f) => products.get(f.productId)?.minQuantity).filter((v): v is number => v != null);
  const suggested = members.map((f) => products.get(f.productId)?.suggestedMin).filter((v): v is number => v != null);
  const minimum =
    userMins.length > 0
      ? Math.max(...userMins)
      : suggested.length > 0
        ? Math.max(...suggested)
        : Math.max(...members.map((f) => f.minimum));
  const usuals = members.map((f) => f.usualQuantity).filter((v): v is number => v !== null);
  const usual = usuals.length > 0 ? Math.max(...usuals) : null;
  const clear = clearLevel(minimum, usual);
  const lowAlert = members.some((f) => f.lowAlert);

  const wasLow = members.some((f) => f.lowByThreshold);
  const lowByThreshold = lowAlert && (wasLow ? total < clear : total <= minimum);

  const rate = combinedRate(members.map((f) => f.rate)) ?? rep.rate;
  const usable = rate.events >= cfg.minEventsForForecast && rate.ratePerDay > 0 && total > 0;
  const runOut = usable ? runOutBand(total, rate, cfg) : null;
  const hasHistory = members.some((f) => f.lastSeq !== null || f.lastRestockAt !== null || f.daysLeft !== null);
  let daysLeft: number | null = null;
  if (total <= 0 && hasHistory) daysLeft = 0;
  else if (runOut) daysLeft = Math.max(0, (runOut.median - now) / DAY_MS);
  const lowByForecast = runOut !== null && daysLeft !== null && daysLeft <= cfg.leadTimeDays + cfg.safetyDays;

  const runningLow = lowAlert && (lowByThreshold || lowByForecast);
  let lowReason: RunningLowReason | null = null;
  if (runningLow) lowReason = total <= 0 ? 'out' : lowByThreshold ? 'threshold' : 'forecast';
  const order = { low: 0, medium: 1, high: 2 } as const;
  const confidence = members.reduce((c, f) => (order[f.confidence] > order[c] ? f.confidence : c), rep.confidence);

  return {
    ...rep,
    totalQuantity: total,
    usualQuantity: usual,
    usualQuantitySource: members.some((f) => f.usualQuantitySource === 'user') ? 'user' : rep.usualQuantitySource,
    minimum,
    clearLevel: clear,
    rate,
    daysLeft,
    runOut,
    confidence,
    lowByThreshold,
    lowByForecast,
    runningLow,
    lowReason,
    lastRestockAt: rep.lastRestockAt,
    lastSeq: members.reduce<number | null>(
      (s, f) => (f.lastSeq !== null && (s === null || f.lastSeq > s) ? f.lastSeq : s),
      null,
    ),
    lowAlert,
    deleted: false,
  };
}

/** A member folded into its kind: present (item screens still read it) but never low by itself. */
function silenced(f: ProductForecast): ProductForecast {
  return { ...f, runOut: null, lowByThreshold: false, lowByForecast: false, runningLow: false, lowReason: null };
}

export function mergeKindForecasts(
  forecasts: readonly ProductForecast[],
  products: ReadonlyMap<string, KindProduct>,
  now: EpochMs,
  cfg: ForecastConfig = DEFAULT_FORECAST_CONFIG,
): KindMerge {
  const byKind = new Map<string, ProductForecast[]>();
  for (const f of forecasts) {
    const p = products.get(f.productId);
    if (!p?.kind || f.deleted || p.deletedAt !== null) continue;
    const key = normalizeName(p.kind);
    const list = byKind.get(key);
    if (list) list.push(f);
    else byKind.set(key, [f]);
  }

  const replaced = new Map<ProductId, ProductForecast>();
  const groups = new Map<ProductId, KindGroup>();
  for (const members of byKind.values()) {
    if (members.length < 2) continue;
    const merged = foldKind(members, products, now, cfg);
    const group: KindGroup = {
      label: products.get(merged.productId)?.kind ?? '',
      representative: merged.productId,
      members: members.map((f) => f.productId),
    };
    for (const f of members) {
      replaced.set(f.productId, f.productId === merged.productId ? merged : silenced(f));
      groups.set(f.productId, group);
    }
  }
  if (replaced.size === 0) return { forecasts: [...forecasts], groups };
  return { forecasts: forecasts.map((f) => replaced.get(f.productId) ?? f), groups };
}
