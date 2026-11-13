import { DEFAULT_FORECAST_CONFIG } from './config';
import { DAY_MS, HOUR_MS, median } from './time';
import type { EpochMs, ForecastConfig, TotalSeries } from './types';

/** §5.6. m = minQuantity ?? (usual != null ? max(1, ceil(0.25 · usual)) : 1). */
export function effectiveMinimum(minQuantity: number | null, usual: number | null): number {
  if (minQuantity !== null) return minQuantity;
  return usual !== null ? Math.max(1, Math.ceil(0.25 * usual)) : 1;
}

/** True when the product can run low: alerts on and a seuil above 0 (a seuil of 0 = no alert threshold). */
export function alertsAt(lowAlert: boolean, minimum: number): boolean {
  return lowAlert && minimum > 0;
}

/** §5.6. c = max(m + 1, ceil(0.5 · (usual ?? 0))). */
export function clearLevel(minimum: number, usual: number | null): number {
  return Math.max(minimum + 1, Math.ceil(0.5 * (usual ?? 0)));
}

function step(low: boolean, total: number, minimum: number, clear: number, lowAlert: boolean): boolean {
  if (!low) return lowAlert && total <= minimum;
  return !(total >= clear || !lowAlert);
}

/**
 * §5.6. Replays the threshold hysteresis over the series with the current settings, then once more
 * on `currentTotal` (the cache total, authoritative for the present; defaults to the last point).
 * A product with no movement is never low, as on the server.
 */
export function replayThresholdState(
  series: TotalSeries,
  minimum: number,
  clear: number,
  lowAlert: boolean,
  deleted: boolean,
  currentTotal?: number,
): boolean {
  if (deleted || series.points.length === 0) return false;
  let low = false;
  for (const p of series.points) low = step(low, p.total, minimum, clear, lowAlert);
  const last = series.points[series.points.length - 1]?.total ?? 0;
  return step(low, currentTotal ?? last, minimum, clear, lowAlert);
}

/** Groups sorted times into sessions (a new one starts when the gap exceeds `mergeHours`). Returns index ranges. */
export function sessionize(times: readonly EpochMs[], mergeHours: number): Array<{ start: number; end: number }> {
  const sessions: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < times.length; i++) {
    const t = times[i] ?? 0;
    const prev = i > 0 ? (times[i - 1] ?? t) : undefined;
    const current = sessions[sessions.length - 1];
    if (current && prev !== undefined && t - prev <= mergeHours * HOUR_MS) current.end = i;
    else sessions.push({ start: i, end: i });
  }
  return sessions;
}

/**
 * §5.5. ceil(median) of the post-restock levels of the last 5 restock sessions started within
 * `historyDays`; else the maximum total reached in that period when above 0; else null. Never 0.
 */
export function usualQuantity(
  series: TotalSeries,
  now: EpochMs,
  cfg: ForecastConfig = DEFAULT_FORECAST_CONFIG,
): number | null {
  const from = now - cfg.historyDays * DAY_MS;
  const restocks = series.points.filter((p) => p.kind === 'restock');
  const sessions = sessionize(
    restocks.map((p) => p.at),
    cfg.sessionMergeHours,
  );
  const levels: number[] = [];
  for (const s of sessions) {
    const first = restocks[s.start];
    const lastRestock = restocks[s.end];
    if (!first || !lastRestock || first.at < from) continue;
    levels.push(lastRestock.total);
  }
  const recent = levels.slice(-5).filter((v) => v > 0);
  if (recent.length > 0) return Math.max(1, Math.ceil(median(recent)));
  let max = 0;
  for (const p of series.points) if (p.at >= from) max = Math.max(max, p.total);
  return max > 0 ? Math.ceil(max) : null;
}
