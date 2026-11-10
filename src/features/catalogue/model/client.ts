/**
 * The subset of the Supabase client the catalogue uses, injected so tests need no environment
 * variables (src/shared/api/supabase.ts throws on import without them). `database.types.ts` is
 * still a placeholder, so the composition root passes the real client with a cast at the boundary:
 * `createCatalogue({ client: supabase as unknown as CatalogueClient, ... })`.
 */
import type { CatalogLookupRequest } from './types';

export interface PostgrestErrorLike {
  message: string;
  code?: string;
}

export interface PostgrestResultLike {
  data: unknown;
  error: PostgrestErrorLike | null;
  /** 0 when the request never reached the server (network failure or abort). */
  status?: number;
}

export interface CatalogueClient {
  from(table: 'catalog_products'): {
    select(columns: string): {
      eq(
        column: 'gtin',
        value: string,
      ): {
        abortSignal(signal: AbortSignal): { maybeSingle(): PromiseLike<PostgrestResultLike> };
      };
    };
  };
  rpc(
    fn: 'search_catalog',
    args: { p_query: string; p_limit: number },
  ): { abortSignal(signal: AbortSignal): PromiseLike<PostgrestResultLike> };
  functions: {
    invoke(
      name: 'catalog-lookup',
      options: { body: CatalogLookupRequest; signal?: AbortSignal; timeout?: number },
    ): Promise<{ data: unknown; error: unknown }>;
  };
  auth?: {
    refreshSession(): Promise<{ error: unknown }>;
  };
}

export type TransportFailure = 'network' | 'aborted' | 'server';

/** Classifies a PostgREST error: transport (status 0) versus a server answer. */
export function classifyPostgrestError(result: PostgrestResultLike): TransportFailure {
  const message = result.error?.message ?? '';
  if (/^(AbortError|TimeoutError)\b/.test(message)) return 'aborted';
  if (result.status === 0 || /^(TypeError|FetchError)\b/.test(message)) return 'network';
  return 'server';
}

/** An AbortSignal that fires on `parent` abort or after `ms`. Avoids AbortSignal.any (iOS 17.4+). */
export function timeoutSignal(ms: number, parent?: AbortSignal): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('Timeout', 'TimeoutError')), ms);
  const onAbort = () => controller.abort(parent?.reason);
  if (parent?.aborted) controller.abort(parent.reason);
  else parent?.addEventListener('abort', onAbort, { once: true });
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener('abort', onAbort);
    },
  };
}

/** Browser connectivity hint; true outside a browser. */
export const browserIsOnline = (): boolean => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);
