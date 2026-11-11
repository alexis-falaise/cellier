/**
 * Facts loading chain: memory → device cache (localStorage, small LRU) → `catalog_facts` through
 * PostgREST → `product-facts` Edge Function (which fills the shared cache from Open Food Facts).
 * A stale copy is shown at once and refreshed in the background; offline, the device copy is kept.
 */
import { FACTS_SELECT_COLUMNS, factsAreFresh, type ProductFacts, toProductFacts } from './facts';

export interface FactsClient {
  from(table: 'catalog_facts'): {
    select(columns: string): {
      eq(column: 'gtin', value: string): { maybeSingle(): PromiseLike<{ data: unknown; error: unknown }> };
    };
  };
  functions: {
    invoke(name: 'product-facts', options: { body: { gtin: string } }): Promise<{ data: unknown; error: unknown }>;
  };
}

export interface FactsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface FactsLoaderDeps {
  client: () => Promise<FactsClient>;
  storage?: FactsStorage | null;
  now?: () => number;
  isOnline?: () => boolean;
}

export type FactsUpdate = { facts: ProductFacts | null; settled: boolean; failed: boolean };

const STORAGE_KEY = 'cellier:facts:v1';
const DEVICE_MAX = 150;

export function createFactsLoader(deps: FactsLoaderDeps) {
  const now = deps.now ?? Date.now;
  const isOnline = deps.isOnline ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  const memory = new Map<string, ProductFacts>();
  const inflight = new Map<string, Promise<ProductFacts | null>>();

  function readDevice(): ProductFacts[] {
    try {
      const raw = deps.storage?.getItem(STORAGE_KEY);
      const list = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(list) ? list.filter((f): f is ProductFacts => typeof f?.gtin === 'string') : [];
    } catch {
      return [];
    }
  }

  function writeDevice(facts: ProductFacts) {
    try {
      if (!deps.storage) return;
      const list = [facts, ...readDevice().filter((f) => f.gtin !== facts.gtin)].slice(0, DEVICE_MAX);
      deps.storage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {
      // Quota or private mode: the memory copy is enough.
    }
  }

  function remember(facts: ProductFacts) {
    memory.set(facts.gtin, facts);
    writeDevice(facts);
  }

  function cached(gtin: string): ProductFacts | null {
    const hit = memory.get(gtin);
    if (hit) return hit;
    const device = readDevice().find((f) => f.gtin === gtin) ?? null;
    if (device) memory.set(gtin, device);
    return device;
  }

  async function fetchRemote(gtin: string): Promise<ProductFacts | null> {
    const client = await deps.client();
    const { data, error } = await client
      .from('catalog_facts')
      .select(FACTS_SELECT_COLUMNS)
      .eq('gtin', gtin)
      .maybeSingle();
    if (!error) {
      const row = toProductFacts(data);
      if (row && factsAreFresh(row, now())) return row;
    }
    const res = await client.functions.invoke('product-facts', { body: { gtin } });
    if (res.error) throw res.error;
    const facts = toProductFacts((res.data as { facts?: unknown } | null)?.facts);
    if (!facts) throw new Error('product-facts: malformed answer');
    return facts;
  }

  function refresh(gtin: string): Promise<ProductFacts | null> {
    let p = inflight.get(gtin);
    if (!p) {
      p = fetchRemote(gtin)
        .then((f) => {
          if (f) remember(f);
          return f;
        })
        .finally(() => inflight.delete(gtin));
      inflight.set(gtin, p);
    }
    return p;
  }

  /** Calls `onUpdate` with the cached copy (if any) and then with the network answer. */
  function load(gtin: string, onUpdate: (u: FactsUpdate) => void): () => void {
    let cancelled = false;
    const emit = (u: FactsUpdate) => {
      if (!cancelled) onUpdate(u);
    };
    const local = cached(gtin);
    if (local && factsAreFresh(local, now())) {
      emit({ facts: local, settled: true, failed: false });
      return () => {
        cancelled = true;
      };
    }
    if (!isOnline()) {
      emit({ facts: local, settled: true, failed: local === null });
      return () => {
        cancelled = true;
      };
    }
    emit({ facts: local, settled: false, failed: false });
    refresh(gtin).then(
      (facts) => emit({ facts: facts ?? local, settled: true, failed: false }),
      (e) => {
        console.warn('[facts] load failed', e);
        emit({ facts: local, settled: true, failed: local === null });
      },
    );
    return () => {
      cancelled = true;
    };
  }

  return { load, peek: cached };
}

export type FactsLoader = ReturnType<typeof createFactsLoader>;
