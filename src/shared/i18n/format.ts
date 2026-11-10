import { t } from './fr';
import { NNBSP } from './typography';

const LOCALE = 'fr-FR';

const decimal = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 });
const euro = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'EUR' });
const time = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit' });
const weekday = new Intl.DateTimeFormat(LOCALE, { weekday: 'long' });
const dayMonth = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short' });
const dayMonthYear = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' });
const weekdayDayMonth = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'short' });

export function formatNumber(value: number): string {
  return decimal.format(value);
}

// Quantities

export type QuantityUnit = 'g' | 'kg' | 'ml' | 'cl' | 'l' | 'piece';

const round2 = (value: number) => Math.round(value * 100) / 100;
const withUnit = (value: number, unit: 'g' | 'kg' | 'ml' | 'cl' | 'l') =>
  `${decimal.format(round2(value))}${NNBSP}${t(`unit.${unit}`)}`;

/**
 * «500 g», «1,5 kg», «75 cl», «1,5 L», «3 pièces».
 * Mass ≥ 1 kg is shown in kg, below in g. Volume ≥ 1 L is shown in L; below, ml stays ml,
 * cl and L become cl (ml if not a whole number of cl).
 */
export function formatQuantity(value: number, unit: QuantityUnit): string {
  switch (unit) {
    case 'piece':
      return t('unit.piece', { n: value });
    case 'g':
    case 'kg': {
      const grams = unit === 'kg' ? value * 1000 : value;
      return Math.abs(grams) >= 1000 ? withUnit(grams / 1000, 'kg') : withUnit(grams, 'g');
    }
    default: {
      const ml = unit === 'l' ? value * 1000 : unit === 'cl' ? value * 10 : value;
      if (Math.abs(ml) >= 1000) return withUnit(ml / 1000, 'l');
      if (unit !== 'ml' && Number.isInteger(round2(ml / 10))) return withUnit(ml / 10, 'cl');
      return withUnit(ml, 'ml');
    }
  }
}

// Prices

/** «1,89 €». */
export function formatEuros(amount: number): string {
  return euro.format(amount);
}

/** «1,89 €» from 189 cents (the domain stores prices in cents). */
export function formatPriceCents(cents: number): string {
  return euro.format(cents / 100);
}

// Dates

const DAY_MS = 86_400_000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Calendar days from `now` to `date` in local time (negative in the past). */
function calendarDays(date: Date, now: Date): number {
  return Math.round((startOfDay(date) - startOfDay(now)) / DAY_MS);
}

/** «18:40». */
export function formatTime(date: Date): string {
  return time.format(date);
}

/** «jeudi 14 nov.». */
export function formatShortDate(date: Date): string {
  return weekdayDayMonth.format(date);
}

/** «3 oct.», with the year when it differs from `now`'s: «3 oct. 2025». */
export function formatDayMonth(date: Date, now: Date = new Date()): string {
  return date.getFullYear() === now.getFullYear() ? dayMonth.format(date) : dayMonthYear.format(date);
}

/**
 * Past timestamps (§3.5): «à l’instant», «il y a 12 min», «aujourd’hui, 14:02», «hier, 18:40»,
 * «lundi» within 6 days, then «3 oct.» or «3 oct. 2025».
 */
export function formatRelativeTime(date: Date, now: Date = new Date()): string {
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes <= 1) return t('time.justNow');
  if (minutes < 60) return t('time.minutesAgo', { n: minutes });
  const days = -calendarDays(date, now);
  if (days === 0) return t('time.todayAt', { time: formatTime(date) });
  if (days === 1) return t('time.yesterdayAt', { time: formatTime(date) });
  if (days <= 6) return weekday.format(date);
  return formatDayMonth(date, now);
}

/** Future day labels (§3.5): «aujourd’hui», «demain», then «samedi 16 nov.». */
export function formatDayLabel(date: Date, now: Date = new Date()): string {
  const days = calendarDays(date, now);
  if (days === 0) return t('time.today');
  if (days === 1) return t('time.tomorrow');
  return formatShortDate(date);
}

// Days of cover (§3.4)

/** «< 1 j», «≈ 4 j», «≈ 3 sem.» from 14 days, «Plus de 2 mois» from 60 days. */
export function formatCover(days: number): string {
  if (days < 1) return t('forecast.badge.lessThanDay');
  if (days < 14) return t('forecast.badge.days', { d: Math.max(1, Math.round(days)) });
  if (days < 60) return t('forecast.badge.weeks', { w: Math.round(days / 7) });
  return t('forecast.cover.months');
}

/** Accessible counterpart of `formatCover`: «Environ 4 jours de stock». */
export function formatCoverA11y(days: number): string {
  if (days < 1) return t('a11y.forecast.lessThanDay');
  if (days < 14) return t('a11y.forecast.days', { d: Math.max(1, Math.round(days)) });
  if (days < 60) return t('a11y.forecast.weeks', { w: Math.round(days / 7) });
  return t('forecast.cover.months');
}
