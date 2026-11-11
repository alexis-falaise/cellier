/**
 * Per-product forecasts for the Stock list (running-low markers) and item detail. Reads the shared
 * household cache (`useHouseholdForecasts`, memoised per product, 04 §5.15) so the app keeps one.
 */
import { useMemo } from 'react';
import type { ProductView } from '@/domain/types';
import { isLowByThreshold } from '@/entities/product';
import type { ProductForecast } from '@/features/forecast';
import { useHouseholdForecasts } from '@/widgets/groceries/model/householdForecasts';

/**
 * Forecast of every live product, by product id, for the running-low marker: a product that shares
 * its kind with others carries the kind's forecast (low only when the kind is).
 */
export function useForecastMap(): ReadonlyMap<string, ProductForecast> {
  const h = useHouseholdForecasts();
  return useMemo(() => {
    if (h.kinds.size === 0) return h.productForecastsById;
    const out = new Map(h.productForecastsById);
    for (const [id, g] of h.kinds) {
      const merged = h.forecastsById.get(g.representative);
      if (merged) out.set(id, merged);
    }
    return out;
  }, [h]);
}

/** One product's forecast (undefined for a deleted or unknown product) and the time it was made at. */
export function useProductForecast(productId: string): { forecast: ProductForecast | undefined; now: number } {
  const h = useHouseholdForecasts();
  return { forecast: h.productForecastsById.get(productId), now: h.now };
}

/** Running low for the amber marker: the forecast rule, or the threshold rule while no forecast exists. */
export function isRunningLow(view: ProductView, forecast: ProductForecast | undefined): boolean {
  return forecast ? forecast.runningLow : isLowByThreshold(view);
}
