import { CATEGORY_PRIORS, DEFAULT_FORECAST_CONFIG } from './config';
import { demandEvents, reconstructTotals } from './ledger';
import { consumptionRate, runOutBand } from './rate';
import { alertsAt, clearLevel, effectiveMinimum, replayThresholdState, usualQuantity } from './threshold';
import { DAY_MS, startOfParisDay } from './time';
import type {
  CategoryPriorTable,
  EpochMs,
  ForecastConfidence,
  ForecastConfig,
  ProductForecast,
  ProductForecastInput,
  RunningLowReason,
} from './types';

/**
 * §5.4 reference time: min(now, max(start of the Paris day, time of the product's last movement)).
 * The estimate is frozen between two movements of the same day; only days left move with `now`.
 */
export function referenceTime(now: EpochMs, lastMovementAt: EpochMs | null): EpochMs {
  return Math.min(now, Math.max(startOfParisDay(now), lastMovementAt ?? Number.NEGATIVE_INFINITY));
}

/** §5.7. Everything about one product. Pure; memoise per product in the caller (§5.15). */
export function forecastProduct(
  input: ProductForecastInput,
  now: EpochMs,
  priors: CategoryPriorTable = CATEGORY_PRIORS,
  cfg: ForecastConfig = DEFAULT_FORECAST_CONFIG,
): ProductForecast {
  const { product, totalQuantity: total } = input;
  const deleted = product.deletedAt !== null;
  const series = reconstructTotals(product.id, input.movements, input.deletedPantryIds, cfg.clientTimeTrustDays);
  const events = demandEvents(series, input.movements);

  const computedUsual = usualQuantity(series, now, cfg);
  const userUsual = product.usualQuantity !== null && product.usualQuantity > 0 ? product.usualQuantity : null;
  const usual = userUsual ?? computedUsual;
  const minimum = effectiveMinimum(product.minQuantity, usual);
  const clear = clearLevel(minimum, usual);

  const lastPoint = series.points[series.points.length - 1];
  const asOf = referenceTime(now, lastPoint?.at ?? null);
  const prior = priors[input.categoryKey ?? 'autre'];
  const rate = consumptionRate(series, events, asOf, prior, usual ?? Number.POSITIVE_INFINITY, cfg);

  const usable = rate.events >= cfg.minEventsForForecast && rate.ratePerDay > 0 && total > 0;
  const runOut = usable ? runOutBand(total, rate, cfg) : null;
  const hasHistory = series.points.length > 0;
  let daysLeft: number | null = null;
  if (total <= 0 && hasHistory) daysLeft = 0;
  else if (runOut) daysLeft = Math.max(0, (runOut.median - now) / DAY_MS);

  let confidence: ForecastConfidence = 'low';
  if (rate.events >= 6 && rate.exposureDays >= 20 && input.householdHasCadence) confidence = 'high';
  else if (rate.events >= 3) confidence = 'medium';

  // A seuil of 0 means «no alert threshold»: never running low, never suggested for the courses.
  const alert = alertsAt(product.lowAlert, minimum);
  const lowByThreshold = replayThresholdState(series, minimum, clear, alert, deleted, total);
  const lowByForecast = runOut !== null && daysLeft !== null && daysLeft <= cfg.leadTimeDays + cfg.safetyDays;
  const runningLow = alert && !deleted && (lowByThreshold || lowByForecast);
  let lowReason: RunningLowReason | null = null;
  if (runningLow) lowReason = total <= 0 ? 'out' : lowByThreshold ? 'threshold' : 'forecast';

  let lastRestockAt: EpochMs | null = null;
  for (const p of series.points) if (p.kind === 'restock') lastRestockAt = p.at;
  let lastSeq: number | null = null;
  for (const m of input.movements) {
    if (m.productId === product.id && m.seq !== null && (lastSeq === null || m.seq > lastSeq)) lastSeq = m.seq;
  }

  return {
    productId: product.id,
    totalQuantity: total,
    usualQuantity: usual,
    usualQuantitySource: userUsual !== null ? 'user' : computedUsual !== null ? 'computed' : null,
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
    lastRestockAt,
    lastSeq,
    lowAlert: alert,
    deleted,
  };
}
