import { browserIsOnline, type CatalogueClient, classifyPostgrestError, timeoutSignal } from './client';
import { toCatalogProduct } from './row';
import { CATALOGUE_SEARCH, type CatalogProduct } from './types';

export type CatalogSearchResult =
  | { kind: 'ok'; query: string; products: CatalogProduct[] }
  /** Fewer than 3 characters after trimming: show local results only. */
  | { kind: 'too_short'; query: string }
  /** «Recherche catalogue indisponible hors ligne». */
  | { kind: 'offline'; query: string }
  /** Timeout or server error. */
  | { kind: 'error'; query: string }
  /** Superseded by a newer query or aborted by the caller; ignore. */
  | { kind: 'aborted'; query: string };

export interface CatalogSearchDeps {
  client: CatalogueClient;
  isOnline?: () => boolean;
}

/** One `search_catalog` RPC call (05 §9): ≥ 3 characters, limit 20, 4 s timeout, de-duplicated by GTIN. */
export async function searchCatalog(
  query: string,
  deps: CatalogSearchDeps,
  signal?: AbortSignal,
): Promise<CatalogSearchResult> {
  const q = query.trim().replace(/\s+/g, ' ');
  if (q.length < CATALOGUE_SEARCH.minChars) return { kind: 'too_short', query: q };
  if (!(deps.isOnline ?? browserIsOnline)()) return { kind: 'offline', query: q };
  if (signal?.aborted) return { kind: 'aborted', query: q };

  const t = timeoutSignal(CATALOGUE_SEARCH.timeoutMs, signal);
  try {
    const result = await deps.client
      .rpc('search_catalog', { p_query: q, p_limit: CATALOGUE_SEARCH.limit })
      .abortSignal(t.signal);
    if (signal?.aborted) return { kind: 'aborted', query: q };
    if (result.error) {
      return classifyPostgrestError(result) === 'network' ? { kind: 'offline', query: q } : { kind: 'error', query: q };
    }
    const seen = new Set<string>();
    const products: CatalogProduct[] = [];
    for (const row of Array.isArray(result.data) ? result.data : []) {
      const p = toCatalogProduct(row);
      if (p && !seen.has(p.gtin)) {
        seen.add(p.gtin);
        products.push(p);
      }
    }
    return { kind: 'ok', query: q, products };
  } catch {
    return signal?.aborted ? { kind: 'aborted', query: q } : { kind: 'error', query: q };
  } finally {
    t.dispose();
  }
}

/**
 * Search-as-you-type helper: each call aborts the previous request, so a late answer to an older
 * query comes back as 'aborted'. Debouncing (200 ms, `CATALOGUE_SEARCH.debounceMs`) stays in the UI.
 */
export function createCatalogSearcher(deps: CatalogSearchDeps) {
  let current: AbortController | null = null;
  return {
    search(query: string): Promise<CatalogSearchResult> {
      current?.abort();
      const controller = new AbortController();
      current = controller;
      return searchCatalog(query, deps, controller.signal);
    },
    cancel(): void {
      current?.abort();
      current = null;
    },
  };
}
