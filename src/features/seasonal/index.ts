/**
 * Seasonal suggestions for Courses: what is in season (ADEME Impact CO2 calendar plus a few
 * regulated seasons), which list rows and products are seasonal foods, and what to buy instead.
 * Pure functions: no React, no I/O, no clock.
 */
export { FOODS_BY_SLUG, SEASONAL_FOODS } from './model/catalog';
export { foodOf, foodOfProduct } from './model/match';
export type { MonthIndex, SeasonalInput } from './model/suggest';
export { inSeason, isYearRound, monthIndex, seasonalSuggestions, seasonStart } from './model/suggest';
export type * from './model/types';
