/**
 * Per-product forecasts for the Stock list (running-low markers) and item detail. Reads the shared
 * household cache (`useHouseholdForecasts`, memoised per product, 04 §5.15) so the app keeps one.
 */
import type { ProductView } from '@/domain/types';
import { isLowByThreshold } from '@/entities/product';
import type { ProductForecast } from '@/features/forecast';
import { useHouseholdForecasts } from '@/widgets/groceries/model/householdForecasts';

/** Forecast of every live product, by product id. */
export function useForecastMap(): ReadonlyMap<string, ProductForecast> {
  return useHouseholdForecasts().forecastsById;
}

/** One product's forecast (undefined for a deleted or unknown product) and the time it was made at. */
export function useProductForecast(productId: string): { forecast: ProductForecast | undefined; now: number } {
  const h = useHouseholdForecasts();
  return { forecast: h.forecastsById.get(productId), now: h.now };
}

/** Running low for the amber marker: the forecast rule, or the threshold rule while no forecast exists. */
export function isRunningLow(view: ProductView, forecast: ProductForecast | undefined): boolean {
  return forecast ? forecast.runningLow : isLowByThreshold(view);
}
