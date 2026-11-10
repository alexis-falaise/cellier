/**
 * «Prévision» card content (design 03 §4.6.4) from a product forecast, with the honesty rules of
 * §3.4: estimates are always «≈», low-confidence (prior-driven) estimates never show days, and a
 * product without withdrawals shows no number.
 */
import { DAY_MS, daysOfCover, type ProductForecast } from '@/features/forecast';
import { formatDayMonth, t } from '@/shared/i18n';

export interface ForecastBandModel {
  /** Positions on a track from today (0) to latest + 10 % (1). */
  start: number;
  end: number;
  median: number;
  earliest: string;
  latest: string;
  medianLabel: string;
  accessibleLabel: string;
}

export interface ForecastCardModel {
  headline: string;
  /** «Épuisement probable entre le … et le ….» */
  sentence: string | null;
  band: ForecastBandModel | null;
  note: string | null;
}

/** «Il en reste pour ≈ 4 j», «≈ 3 sem.», «Plus de 2 mois». */
export function coverHeadline(days: number): string {
  if (days >= 60) return t('forecast.cover.months');
  if (days >= 14) return t('forecast.cover.weeks', { w: Math.round(days / 7) });
  return t('forecast.cover.days', { d: Math.max(1, Math.round(days)) });
}

export function forecastCard(forecast: ProductForecast | undefined, now: number): ForecastCardModel {
  const none: ForecastCardModel = {
    headline: t('forecast.none.title'),
    sentence: null,
    band: null,
    note: t('forecast.none.body'),
  };
  if (!forecast) return none;
  if (forecast.totalQuantity <= 0) {
    return {
      headline: t('forecast.out'),
      sentence: null,
      band: null,
      note: forecast.lowAlert ? t('forecast.onList') : null,
    };
  }
  const { rate, runOut, confidence } = forecast;
  if (rate.events === 0) return none;

  if (!runOut || confidence === 'low') {
    // Prior-driven: weeks only, never days, no band.
    if (!(rate.ratePerDay > 0)) return none;
    const days = daysOfCover(forecast.totalQuantity, rate.ratePerDay);
    return {
      headline:
        days >= 60 ? t('forecast.cover.months') : t('forecast.badge.weeks', { w: Math.max(1, Math.round(days / 7)) }),
      sentence: null,
      band: null,
      note: t('forecast.confidence.low'),
    };
  }

  const days = Math.max(0, (runOut.median - now) / DAY_MS);
  const span = Math.max(DAY_MS, (runOut.latest - now) * 1.1);
  const pos = (t0: number) => Math.min(1, Math.max(0, (t0 - now) / span));
  const earliest = formatDayMonth(new Date(runOut.earliest), new Date(now));
  const latest = formatDayMonth(new Date(runOut.latest), new Date(now));
  const median = formatDayMonth(new Date(runOut.median), new Date(now));
  return {
    headline: coverHeadline(days),
    sentence:
      confidence === 'high'
        ? t('forecast.band', { earliest, latest })
        : t('forecast.bandMedian', { median, earliest, latest }),
    band: {
      start: pos(runOut.earliest),
      end: pos(runOut.latest),
      median: pos(runOut.median),
      earliest,
      latest,
      medianLabel: median,
      accessibleLabel: t('a11y.forecast.band', { earliest, latest, median }),
    },
    note:
      confidence === 'high'
        ? t('forecast.confidence.high', { n: rate.events })
        : t('forecast.confidence.medium', { n: rate.events }),
  };
}

/** «Seuil» suggestion of §4.6.5: max(1, ceil(25 % of the usual quantity)), null without one. */
export function suggestedMinimum(usualQuantity: number | null): number | null {
  if (usualQuantity === null || !(usualQuantity > 0)) return null;
  return Math.max(1, Math.ceil(0.25 * usualQuantity));
}
