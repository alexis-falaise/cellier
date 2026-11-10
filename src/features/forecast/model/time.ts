import type { IsoDate } from '@/domain/types';
import type { EpochMs } from './types';

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

const PARIS = 'Europe/Paris';

const partsFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: PARIS,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  weekday: 'short',
});

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

interface ParisParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

function parisParts(t: EpochMs): ParisParts {
  const out: Record<string, string> = {};
  for (const p of partsFormat.formatToParts(new Date(t))) out[p.type] = p.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour),
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: WEEKDAYS[out.weekday ?? ''] ?? 0,
  };
}

/** Paris UTC offset at `t`, in ms (3 600 000 in winter, 7 200 000 in summer). */
function parisOffset(t: EpochMs): number {
  const p = parisParts(t);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(t / 1000) * 1000;
}

/** Start of the Europe/Paris calendar day containing `t`. Midnight always exists in Paris (DST switches at 2–3 h). */
export function startOfParisDay(t: EpochMs): EpochMs {
  const p = parisParts(t);
  const wall = Date.UTC(p.year, p.month - 1, p.day);
  const guess = wall - parisOffset(wall);
  return wall - parisOffset(guess);
}

/** Europe/Paris calendar date `YYYY-MM-DD` of `t`. */
export function parisDate(t: EpochMs): IsoDate {
  const p = parisParts(t);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Europe/Paris weekday of `t`, 0 = Sunday … 6 = Saturday. */
export function parisWeekday(t: EpochMs): number {
  return parisParts(t).weekday;
}

/** Median of a non-empty list. */
export function median(values: readonly number[]): number {
  return quantile(values, 0.5);
}

/** Quantile with linear interpolation between order statistics (type 7). */
export function quantile(values: readonly number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return Number.NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo] ?? 0;
  const b = sorted[hi] ?? a;
  return a + (b - a) * (pos - lo);
}
