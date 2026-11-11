import { useEffect, useState } from 'react';
import { createFactsLoader, type FactsClient, type FactsUpdate } from './model/load';

const loader = createFactsLoader({
  client: async () => (await import('@/shared/api/supabase')).supabase as unknown as FactsClient,
  storage: (() => {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
      return null;
    }
  })(),
});

const IDLE: FactsUpdate = { facts: null, settled: true, failed: false };

/** Facts for one GTIN (null: no barcode). Re-renders with the cached copy, then the fresh one. */
export function useProductFacts(gtin: string | null): FactsUpdate {
  const [state, setState] = useState<FactsUpdate>(() =>
    gtin ? { facts: loader.peek(gtin), settled: false, failed: false } : IDLE,
  );
  useEffect(() => {
    if (!gtin) {
      setState(IDLE);
      return;
    }
    return loader.load(gtin, setState);
  }, [gtin]);
  return state;
}
