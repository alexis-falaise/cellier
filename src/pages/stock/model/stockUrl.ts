import { useRouter } from '@tanstack/react-router';
import { TAB_ROOTS } from '@/app/stack';

type StockParam = 'q' | 'group' | 'sort' | 'dir';

const NAV_STATE_KEYS = ['cellierSheetBase', 'cellierConfirmBase', 'cellierCoverBase'] as const;

/**
 * Writes `/stock` params in place (replace, no history entry), keeping the overlay params and the
 * sheet bookkeeping of src/app/navigation.ts. Does nothing when the Stock root is not the current
 * location (a debounced search write after a push).
 */
export function useStockUrl(): (patch: Partial<Record<StockParam, string | undefined>>) => void {
  const router = useRouter();
  return (patch) => {
    const location = router.state.location;
    const path = location.pathname.replace(/\/+$/, '') || '/';
    if (path !== TAB_ROOTS.stock) return;
    const next: Record<string, unknown> = { ...(location.search as Record<string, unknown>) };
    let changed = false;
    for (const [key, value] of Object.entries(patch)) {
      if (next[key] === value || (value === undefined && !(key in next))) continue;
      changed = true;
      if (value === undefined) delete next[key];
      else next[key] = value;
    }
    if (!changed) return;
    const current = (router.history.location.state ?? {}) as unknown as Record<string, unknown>;
    const state: Record<string, unknown> = {};
    for (const key of NAV_STATE_KEYS) if (current[key] !== undefined) state[key] = current[key];
    void router.navigate({ to: TAB_ROOTS.stock, search: next, replace: true, state } as never);
  };
}
