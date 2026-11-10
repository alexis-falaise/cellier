import { DEFAULT_FORECAST_CONFIG } from './config';
import { DAY_MS } from './time';
import type {
  CategoryPrior,
  DemandEvent,
  EpochMs,
  ForecastConfig,
  RateEstimate,
  RunOutBand,
  TotalSeries,
} from './types';

/**
 * §5.4. Weighted in-stock exposure E in days: Σ (w(b) − w(a)) / λ over the intervals of
 * [asOf − W, asOf] during which the household total was above 0. Time before the first known
 * movement is not observed and does not count.
 */
export function exposureDays(
  series: TotalSeries,
  asOf: EpochMs,
  cfg: ForecastConfig = DEFAULT_FORECAST_CONFIG,
): number {
  const lambda = Math.LN2 / cfg.halfLifeDays;
  const from = asOf - cfg.windowDays * DAY_MS;
  const w = (t: EpochMs) => Math.exp((-lambda * (asOf - t)) / DAY_MS);
  let exposure = 0;
  const { points } = series;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!p || p.total <= 0) continue;
    const a = Math.max(p.at, from);
    const b = Math.min(points[i + 1]?.at ?? asOf, asOf);
    if (b > a) exposure += (w(b) - w(a)) / lambda;
  }
  return exposure;
}

/** §5.4. Exposure-weighted, decayed, Gamma-shrunk rate. `eventCap` = usual quantity, or Infinity when unknown. */
export function consumptionRate(
  series: TotalSeries,
  events: readonly DemandEvent[],
  asOf: EpochMs,
  prior: CategoryPrior,
  eventCap: number,
  cfg: ForecastConfig = DEFAULT_FORECAST_CONFIG,
): RateEstimate {
  const lambda = Math.LN2 / cfg.halfLifeDays;
  const from = asOf - cfg.windowDays * DAY_MS;
  const cap = eventCap > 0 ? eventCap : Number.POSITIVE_INFINITY;
  let weightedQuantity = 0;
  let count = 0;
  for (const e of events) {
    if (e.at < from || e.at > asOf) continue;
    count++;
    weightedQuantity += Math.min(e.quantity, cap) * Math.exp((-lambda * (asOf - e.at)) / DAY_MS);
  }
  const exposure = exposureDays(series, asOf, cfg);
  const a0 = prior.ratePerDay * prior.strengthDays;
  const b0 = prior.strengthDays;
  const shape = a0 + weightedQuantity;
  return {
    ratePerDay: b0 + exposure > 0 ? shape / (b0 + exposure) : 0,
    rawRate: exposure > 0 ? weightedQuantity / exposure : 0,
    shape,
    exposureDays: exposure,
    weightedQuantity,
    events: count,
    asOf,
  };
}

/** §5.4. total / rate; 0 when total ≤ 0; Infinity when rate is 0. */
export function daysOfCover(total: number, ratePerDay: number): number {
  if (total <= 0) return 0;
  if (ratePerDay <= 0) return Number.POSITIVE_INFINITY;
  return total / ratePerDay;
}

/** §5.4. Log-normal 80 % band around asOf + cover. null when rate is 0 or total ≤ 0. */
export function runOutBand(
  total: number,
  rate: RateEstimate,
  cfg: ForecastConfig = DEFAULT_FORECAST_CONFIG,
): RunOutBand | null {
  if (total <= 0 || rate.ratePerDay <= 0 || rate.shape <= 0) return null;
  const cover = daysOfCover(total, rate.ratePerDay);
  const spread = cfg.bandZ / Math.sqrt(rate.shape);
  return {
    median: rate.asOf + cover * DAY_MS,
    earliest: rate.asOf + cover * Math.exp(-spread) * DAY_MS,
    latest: rate.asOf + cover * Math.exp(spread) * DAY_MS,
  };
}
