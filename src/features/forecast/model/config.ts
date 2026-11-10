import type { CategoryPriorTable, ForecastConfig } from './types';

/** Defaults of 04 §5.13. Starting points to calibrate, not measurements. */
export const DEFAULT_FORECAST_CONFIG: ForecastConfig = Object.freeze({
  windowDays: 90,
  halfLifeDays: 30,
  priorStrengthDays: 14,
  leadTimeDays: 2,
  safetyDays: 2,
  sessionMergeHours: 6,
  historyDays: 180,
  minSessions: 3,
  criticalCount: 3,
  defaultTripGapDays: 7,
  minEventsForForecast: 3,
  bandZ: 1.2816,
  clientTimeTrustDays: 7,
  timeZone: 'Europe/Paris',
});

const k = DEFAULT_FORECAST_CONFIG.priorStrengthDays;
const prior = (ratePerDay: number) => Object.freeze({ ratePerDay, strengthDays: k });

/** Category prior rates, units per in-stock day, for a household of about two (04 §5.13). */
export const CATEGORY_PRIORS: CategoryPriorTable = Object.freeze({
  legumes: prior(0.3),
  fruits: prior(0.4),
  feculents: prior(0.06),
  poisson: prior(0.05),
  viande: prior(0.15),
  laitier: prior(0.35),
  pain: prior(0.3),
  apero: prior(0.08),
  epicerie_sucree: prior(0.05),
  chocolat: prior(0.08),
  petit_dej: prior(0.06),
  conserves: prior(0.08),
  surgeles: prior(0.08),
  plats: prior(0.1),
  soft: prior(0.15),
  jus: prior(0.15),
  eau: prior(0.5),
  vin: prior(0.08),
  biere: prior(0.1),
  cafe: prior(0.07),
  condiments: prior(0.03),
  bebe: prior(0.3),
  animaux: prior(0.1),
  entretien: prior(0.03),
  hygiene: prior(0.03),
  papier: prior(0.1),
  pharmacie: prior(0.02),
  autre: prior(0.1),
});
