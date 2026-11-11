/**
 * Forecasting (04-notifications-forecasting.md §5). Pure functions: no React, no I/O, no clock.
 * `now` and every input are arguments; memoise per product in the store selectors (§5.15).
 */
export { nextTrip, shoppingCadence } from './model/cadence';
export { CATEGORY_PRIORS, DEFAULT_FORECAST_CONFIG } from './model/config';
export type { KindGroup, KindMerge, KindProduct } from './model/kinds';
export { mergeKindForecasts } from './model/kinds';
export { demandEvents, householdRestockTimes, movementTime, orderLedger, reconstructTotals } from './model/ledger';
export type {
  GroceryItem,
  GroceryLabelItem,
  GroceryList,
  GroceryListInput,
  GroceryProductItem,
  GroceryReason,
} from './model/lists';
export { groceryList, isDismissalActive, runningLowView, shoppingList, suggestedQuantity } from './model/lists';
export { forecastProduct, referenceTime } from './model/product';
export { consumptionRate, daysOfCover, exposureDays, runOutBand } from './model/rate';
export { clearLevel, effectiveMinimum, replayThresholdState, usualQuantity } from './model/threshold';
export { DAY_MS, parisDate, parisWeekday, startOfParisDay } from './model/time';
export type * from './model/types';
