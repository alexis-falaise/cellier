import { DEFAULT_FORECAST_CONFIG } from './config';
import { sessionize } from './threshold';
import { DAY_MS, median, parisDate, parisWeekday, quantile } from './time';
import type { Cadence, EpochMs, ForecastConfidence, ForecastConfig, NextTrip, ProductForecast } from './types';

/**
 * §5.8. Household shopping cadence from the effective times of every restock movement (see
 * `householdRestockTimes`). null with fewer than `minSessions` sessions in `historyDays`.
 */
export function shoppingCadence(
  restockTimes: readonly EpochMs[],
  now: EpochMs,
  cfg: ForecastConfig = DEFAULT_FORECAST_CONFIG,
): Cadence | null {
  const from = now - cfg.historyDays * DAY_MS;
  const times = restockTimes.filter((t) => t >= from && t <= now).sort((a, b) => a - b);
  const starts = sessionize(times, cfg.sessionMergeHours).map((s) => times[s.start] ?? 0);
  if (starts.length < cfg.minSessions) return null;

  const recent = starts.slice(-12);
  const gaps: number[] = [];
  for (let i = 1; i < recent.length; i++) gaps.push(((recent[i] ?? 0) - (recent[i - 1] ?? 0)) / DAY_MS);
  const medianGapDays = median(gaps);
  const iqr = quantile(gaps, 0.75) - quantile(gaps, 0.25);

  // Most frequent Paris weekday; ties go to the weekday of the most recent session among them.
  const counts = new Map<number, number>();
  const lastSeen = new Map<number, number>();
  recent.forEach((t, i) => {
    const d = parisWeekday(t);
    counts.set(d, (counts.get(d) ?? 0) + 1);
    lastSeen.set(d, i);
  });
  let usualWeekday = 0;
  let best = -1;
  for (const [d, c] of counts) {
    if (c > best || (c === best && (lastSeen.get(d) ?? 0) > (lastSeen.get(usualWeekday) ?? 0))) {
      usualWeekday = d;
      best = c;
    }
  }

  const sessions = starts.length;
  let confidence: ForecastConfidence = 'low';
  if (sessions >= 6 && iqr <= 0.5 * medianGapDays) confidence = 'high';
  else if (sessions >= 4) confidence = 'medium';

  const lastSessionAt = recent[recent.length - 1] ?? now;
  return {
    medianGapDays,
    usualWeekday,
    usualWeekdayShare: best / recent.length,
    sessions,
    confidence,
    lastSessionAt,
    nextAt: Math.max(lastSessionAt + medianGapDays * DAY_MS, now + DAY_MS),
  };
}

/**
 * §5.8. Suggested next shopping date: the cadence date (or now + default gap), pulled forward to
 * the n-th soonest median run-out among products with a usable forecast; never before now.
 * Without a cadence no date is suggested (`tripOn` null); `tripAt` is then only the list horizon.
 */
export function nextTrip(
  cadence: Cadence | null,
  forecasts: readonly ProductForecast[],
  now: EpochMs,
  cfg: ForecastConfig = DEFAULT_FORECAST_CONFIG,
): NextTrip {
  const medians = forecasts
    .filter((f) => f.runOut !== null && !f.deleted && f.lowAlert)
    .map((f) => f.runOut?.median ?? 0)
    .sort((a, b) => a - b);
  const criticalAt = medians[cfg.criticalCount - 1] ?? Number.POSITIVE_INFINITY;
  const planned = cadence ? cadence.nextAt : now + cfg.defaultTripGapDays * DAY_MS;
  const tripAt = Math.max(now, Math.min(planned, criticalAt));
  return {
    tripAt,
    tripOn: cadence ? parisDate(tripAt) : null,
    cadence,
    gapDays: cadence ? cadence.medianGapDays : cfg.defaultTripGapDays,
    pulledForward: criticalAt < planned,
  };
}
