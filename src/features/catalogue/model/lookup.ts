import type { Gtin, ProductId } from '@/domain/types';
import { parseBarcode, type ScannedCode } from '@/shared/lib/gtin';
import {
  browserIsOnline,
  type CatalogueClient,
  classifyPostgrestError,
  type PostgrestResultLike,
  timeoutSignal,
} from './client';
import { NegativeCache } from './negativeCache';
import { parseFunctionProduct, toCatalogProduct } from './row';
import {
  CATALOG_SELECT_COLUMNS,
  CATALOGUE_TIMEOUTS,
  type CatalogLookupDraft,
  type CatalogProduct,
  type ScanOutcome,
} from './types';

/** What the device knows without the network (household store, then device cache). */
export type LocalLookupResult =
  | { source: 'household'; productId: ProductId; deleted: boolean }
  | { source: 'device_cache'; product: CatalogProduct };

export interface CatalogueLookupDeps {
  client: CatalogueClient;
  /**
   * Steps 2–3 of 05 §8.1, provided by the sync store: the household product with this GTIN
   * (tombstones included), else the device-cache row, else null.
   */
  lookupLocal: (gtin: Gtin) => LocalLookupResult | null | Promise<LocalLookupResult | null>;
  /** Receives every row fetched from the server, to write the device cache. */
  remember?: (product: CatalogProduct) => void;
  /** Connectivity hint (default `navigator.onLine`). */
  isOnline?: () => boolean;
  /** Clock for the in-memory caches (default `Date.now`). */
  now?: () => number;
  /** In-memory "not found" lifetime for this session, ms (default 30 min). */
  negativeCacheTtlMs?: number;
}

export interface LookupOptions {
  /** Aborting rejects the lookup with the signal's reason. */
  signal?: AbortSignal;
}

export interface CatalogueLookup {
  /** The lookup chain of 05 §8.1 for a parsed scan or typed digits. */
  lookup(input: ScannedCode | string, options?: LookupOptions): Promise<ScanOutcome>;
  /** Forgets the session caches (sign-out, household switch). */
  reset(): void;
}

interface FnErrorLike {
  name?: string;
  context?: unknown;
}

interface ResponseLike {
  status: number;
  headers?: { get(name: string): string | null };
  json?: () => Promise<unknown>;
}

const isResponseLike = (v: unknown): v is ResponseLike =>
  typeof v === 'object' && v !== null && typeof (v as { status?: unknown }).status === 'number';

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
}

function retryAfterSeconds(body: unknown, response: ResponseLike): number | null {
  const fromBody = (body as { retryAfter?: unknown } | null)?.retryAfter;
  if (typeof fromBody === 'number' && Number.isFinite(fromBody)) return fromBody;
  const header = Number(response.headers?.get('Retry-After'));
  return Number.isFinite(header) && header > 0 ? header : null;
}

/**
 * Creates the scan lookup chain (05 §8.1): local → `catalog_products` → `catalog-lookup` Edge
 * Function → not found. Never calls Open Food Facts directly. Offline, nothing is queued: the
 * outcome is 'offline' and the UI offers manual entry.
 */
export function createCatalogueLookup(deps: CatalogueLookupDeps): CatalogueLookup {
  const isOnline = deps.isOnline ?? browserIsOnline;
  const now = deps.now ?? Date.now;
  const misses = new NegativeCache<CatalogLookupDraft>(deps.negativeCacheTtlMs ?? 30 * 60_000, 500, now);
  const inFlight = new Map<Gtin, Promise<ScanOutcome>>();
  let blockedUntil = 0;

  const remember = (product: CatalogProduct) => {
    try {
      deps.remember?.(product);
    } catch {
      // The device cache is best effort.
    }
  };

  async function selectRow(gtin: Gtin, signal?: AbortSignal): Promise<ScanOutcome | 'continue'> {
    const t = timeoutSignal(CATALOGUE_TIMEOUTS.selectMs, signal);
    let result: PostgrestResultLike;
    try {
      result = await deps.client
        .from('catalog_products')
        .select(CATALOG_SELECT_COLUMNS)
        .eq('gtin', gtin)
        .abortSignal(t.signal)
        .maybeSingle();
    } catch {
      result = { data: null, error: { message: 'TypeError: request failed' }, status: 0 };
    } finally {
      t.dispose();
    }
    throwIfAborted(signal);
    if (result.error) {
      const failure = classifyPostgrestError(result);
      if (failure === 'network' || !isOnline()) return { kind: 'offline', gtin };
      return 'continue'; // timeout or server error: the Edge Function re-checks the catalogue anyway
    }
    const product = toCatalogProduct(result.data);
    if (!product) return 'continue';
    remember(product);
    return { kind: 'found_catalogue', gtin, product, via: 'database' };
  }

  async function invokeFunction(gtin: Gtin, signal: AbortSignal | undefined, retried: boolean): Promise<ScanOutcome> {
    const t = timeoutSignal(CATALOGUE_TIMEOUTS.functionMs, signal);
    let data: unknown = null;
    let error: unknown = null;
    try {
      ({ data, error } = await deps.client.functions.invoke('catalog-lookup', { body: { gtin }, signal: t.signal }));
    } catch (e) {
      error = { name: 'FunctionsFetchError', context: e };
    } finally {
      t.dispose();
    }
    throwIfAborted(signal);

    if (error) {
      const err = error as FnErrorLike;
      const response = isResponseLike(err.context) ? err.context : null;
      if (!response) {
        const cause = (err.context as { name?: string } | undefined)?.name;
        if (cause === 'AbortError' || cause === 'TimeoutError')
          return { kind: 'lookup_unavailable', gtin, retryAfter: null };
        return isOnline() && err.name !== 'FunctionsFetchError'
          ? { kind: 'lookup_unavailable', gtin, retryAfter: null }
          : { kind: 'offline', gtin };
      }
      if (response.status === 401 && !retried && deps.client.auth) {
        const refreshed = await deps.client.auth.refreshSession().catch((e: unknown) => ({ error: e }));
        throwIfAborted(signal);
        if (!refreshed.error) return invokeFunction(gtin, signal, true);
      }
      const body = await response.json?.().catch(() => null);
      const code = (body as { code?: unknown } | null)?.code;
      if (code === 'restricted_gtin') return { kind: 'variable_measure', raw: gtin };
      if (response.status === 400) return { kind: 'not_found', gtin, draft: null };
      const retryAfter = retryAfterSeconds(body, response);
      if (retryAfter !== null && (response.status === 429 || response.status === 503)) {
        blockedUntil = now() + retryAfter * 1000;
      }
      return { kind: 'lookup_unavailable', gtin, retryAfter };
    }

    const answer = data as { outcome?: unknown; product?: unknown; draft?: unknown } | null;
    if (answer?.outcome === 'found') {
      const product = parseFunctionProduct(answer.product);
      if (product) {
        remember(product);
        return { kind: 'found_online', gtin, product };
      }
    }
    if (answer?.outcome === 'not_found') {
      const draft = (typeof answer.draft === 'object' ? answer.draft : null) as CatalogLookupDraft;
      misses.set(gtin, draft);
      return { kind: 'not_found', gtin, draft };
    }
    return { kind: 'lookup_unavailable', gtin, retryAfter: null };
  }

  async function chain(gtin: Gtin, signal?: AbortSignal): Promise<ScanOutcome> {
    let local: LocalLookupResult | null = null;
    try {
      local = await deps.lookupLocal(gtin);
    } catch {
      local = null; // a broken local store must not block the scan
    }
    throwIfAborted(signal);
    if (local?.source === 'household') {
      return { kind: 'found_household', gtin, productId: local.productId, restoredFromTombstone: local.deleted };
    }
    if (local?.source === 'device_cache')
      return { kind: 'found_catalogue', gtin, product: local.product, via: 'device_cache' };

    const miss = misses.get(gtin);
    if (miss !== undefined) return { kind: 'not_found', gtin, draft: miss };
    if (!isOnline()) return { kind: 'offline', gtin };

    const selected = await selectRow(gtin, signal);
    if (selected !== 'continue') return selected;

    const wait = blockedUntil - now();
    if (wait > 0) return { kind: 'lookup_unavailable', gtin, retryAfter: Math.ceil(wait / 1000) };
    return invokeFunction(gtin, signal, false);
  }

  return {
    async lookup(input, options = {}) {
      const parsed = typeof input === 'string' ? parseBarcode(input) : { ok: true as const, code: input };
      if (!parsed.ok) {
        const raw = typeof input === 'string' ? input.replace(/[\s-]/g, '') : '';
        return parsed.error === 'check-digit' ? { kind: 'invalid_checksum', raw } : { kind: 'invalid_format', raw };
      }
      const code = parsed.code;
      if (code.kind === 'variable-measure') return { kind: 'variable_measure', raw: code.digits };
      const gtin = code.gtin14 as Gtin;
      throwIfAborted(options.signal);

      const pending = inFlight.get(gtin);
      if (pending && !options.signal) return pending;
      const promise = chain(gtin, options.signal).finally(() => {
        if (inFlight.get(gtin) === promise) inFlight.delete(gtin);
      });
      if (!options.signal) inFlight.set(gtin, promise);
      return promise;
    },
    reset() {
      misses.clear();
      inFlight.clear();
      blockedUntil = 0;
    },
  };
}
