import { describe, expect, it, vi } from 'vitest';
import type { Category, CategoryId, Gtin, ProductId } from '@/domain/types';
import { computeCheckDigit, parseBarcode } from '@/shared/lib/gtin';
import type { CatalogueClient, PostgrestResultLike } from './client';
import { createCatalogueLookup, type LocalLookupResult } from './lookup';
import { toCatalogProduct } from './row';
import { createCatalogSearcher, searchCatalog } from './search';
import { catalogueToProductCreate, displayablePriceCents, resolveHouseholdCategory } from './toProduct';
import type { CatalogProduct, CatalogProductRow } from './types';

const NUTELLA = '3017620422003';
const NUTELLA_14 = '03017620422003' as Gtin;

const row = (o: Partial<CatalogProductRow> = {}): CatalogProductRow => ({
  gtin: NUTELLA_14,
  name: 'Pâte à tartiner',
  brand: 'Nutella',
  quantity_label: '400 g',
  net_quantity: '400.000',
  net_unit: 'g',
  pack_count: 1,
  category_key: 'petit_dej',
  category_rule: 'v3|tier2:en:spreads',
  image_url: 'https://images.openfoodfacts.org/x.jpg',
  source: 'off',
  store_tags: ['leclerc', 'bogus'],
  popularity: 120,
  price_cents: 389,
  price_observed_on: '2026-10-01',
  price_chain: 'carrefour',
  search_text: 'pate a tartiner nutella',
  source_modified_at: '2026-09-01T00:00:00Z',
  ...o,
});

const product = (o: Partial<CatalogProduct> = {}): CatalogProduct => {
  const p = toCatalogProduct(row());
  if (!p) throw new Error('fixture');
  return { ...p, ...o };
};

interface FakeOptions {
  select?: (gtin: string) => PostgrestResultLike | Promise<PostgrestResultLike>;
  invoke?: (gtin: string) => { data: unknown; error: unknown } | Promise<{ data: unknown; error: unknown }>;
  rpc?: (args: { p_query: string; p_limit: number }, signal: AbortSignal) => Promise<PostgrestResultLike>;
  refresh?: () => Promise<{ error: unknown }>;
}

function fakeClient(o: FakeOptions = {}) {
  const calls = { select: [] as string[], invoke: [] as string[], rpc: [] as string[], refresh: 0 };
  const client: CatalogueClient = {
    from: () => ({
      select: () => ({
        eq: (_col, value) => ({
          abortSignal: () => ({
            maybeSingle: async () => {
              calls.select.push(value);
              return o.select ? o.select(value) : { data: null, error: null, status: 200 };
            },
          }),
        }),
      }),
    }),
    rpc: (_fn, args) => ({
      abortSignal: (signal) => {
        calls.rpc.push(args.p_query);
        return o.rpc ? o.rpc(args, signal) : Promise.resolve({ data: [], error: null, status: 200 });
      },
    }),
    functions: {
      invoke: async (_name, { body }) => {
        calls.invoke.push(body.gtin);
        return o.invoke
          ? o.invoke(body.gtin)
          : { data: { outcome: 'not_found', cached: false, draft: null }, error: null };
      },
    },
    auth: {
      refreshSession: async () => {
        calls.refresh++;
        return o.refresh ? o.refresh() : { error: null };
      },
    },
  };
  return { client, calls };
}

const httpError = (status: number, body: unknown, headers: Record<string, string> = {}) => ({
  data: null,
  error: {
    name: 'FunctionsHttpError',
    context: {
      status,
      headers: { get: (k: string) => headers[k] ?? null },
      json: async () => body,
    },
  },
});

const noLocal = () => null;

describe('toCatalogProduct', () => {
  it('maps a snake_case row and drops unknown values', () => {
    const p = toCatalogProduct(row({ category_key: 'not_a_slug', net_unit: 'kg' as never }));
    expect(p).toMatchObject({
      gtin: NUTELLA_14,
      name: 'Pâte à tartiner',
      netQuantity: 400,
      netUnit: null,
      categoryKey: null,
      storeTags: ['leclerc'],
      priceChain: 'carrefour',
    });
    expect(toCatalogProduct({ gtin: '123', name: 'x' })).toBeNull();
    expect(toCatalogProduct(null)).toBeNull();
  });
});

describe('lookup chain', () => {
  it('rejects bad codes and routes in-store codes to manual entry without any call', async () => {
    const { client, calls } = fakeClient();
    const l = createCatalogueLookup({ client, lookupLocal: noLocal, isOnline: () => true });
    expect(await l.lookup('3017620422004')).toEqual({ kind: 'invalid_checksum', raw: '3017620422004' });
    expect(await l.lookup('12345')).toEqual({ kind: 'invalid_format', raw: '12345' });
    const inStore = `212345600000${computeCheckDigit('212345600000')}`;
    expect(await l.lookup(inStore)).toEqual({ kind: 'variable_measure', raw: inStore });
    expect(calls.select).toEqual([]);
    expect(calls.invoke).toEqual([]);
  });

  it('accepts the scanner’s parsed code', async () => {
    const parsed = parseBarcode(NUTELLA);
    if (!parsed.ok) throw new Error('fixture');
    const lookupLocal = vi.fn(
      (): LocalLookupResult => ({ source: 'household', productId: 'p1' as ProductId, deleted: true }),
    );
    const { client } = fakeClient();
    const l = createCatalogueLookup({ client, lookupLocal, isOnline: () => true });
    expect(await l.lookup(parsed.code)).toEqual({
      kind: 'found_household',
      gtin: NUTELLA_14,
      productId: 'p1',
      restoredFromTombstone: true,
    });
    expect(lookupLocal).toHaveBeenCalledWith(NUTELLA_14);
  });

  it('answers from the device cache before the network', async () => {
    const { client, calls } = fakeClient();
    const l = createCatalogueLookup({
      client,
      lookupLocal: () => ({ source: 'device_cache', product: product() }),
      isOnline: () => true,
    });
    expect(await l.lookup(NUTELLA)).toMatchObject({ kind: 'found_catalogue', via: 'device_cache' });
    expect(calls.select).toEqual([]);
  });

  it('finds the row in catalog_products and remembers it', async () => {
    const remember = vi.fn();
    const { client, calls } = fakeClient({ select: () => ({ data: row(), error: null, status: 200 }) });
    const l = createCatalogueLookup({ client, lookupLocal: noLocal, remember, isOnline: () => true });
    const out = await l.lookup(NUTELLA);
    expect(out).toMatchObject({ kind: 'found_catalogue', via: 'database', product: { brand: 'Nutella' } });
    expect(calls.select).toEqual([NUTELLA_14]);
    expect(calls.invoke).toEqual([]);
    expect(remember).toHaveBeenCalledOnce();
  });

  it('calls the Edge Function when the catalogue has no row', async () => {
    const remember = vi.fn();
    const camel = product({ name: 'Nouveau' });
    const { client, calls } = fakeClient({
      invoke: () => ({
        data: { outcome: 'found', origin: 'open_food_facts', product: camel, persisted: true },
        error: null,
      }),
    });
    const l = createCatalogueLookup({ client, lookupLocal: noLocal, remember, isOnline: () => true });
    expect(await l.lookup(NUTELLA)).toMatchObject({ kind: 'found_online', product: { name: 'Nouveau' } });
    expect(calls.invoke).toEqual([NUTELLA_14]);
    expect(remember).toHaveBeenCalledWith(expect.objectContaining({ name: 'Nouveau' }));
  });

  it('caches not-found answers in memory, with their draft, and expires them', async () => {
    let now = 1_000;
    const draft = { brand: 'Marque' };
    const { client, calls } = fakeClient({
      invoke: () => ({ data: { outcome: 'not_found', cached: false, draft }, error: null }),
    });
    const l = createCatalogueLookup({
      client,
      lookupLocal: noLocal,
      isOnline: () => true,
      now: () => now,
      negativeCacheTtlMs: 60_000,
    });
    expect(await l.lookup(NUTELLA)).toEqual({ kind: 'not_found', gtin: NUTELLA_14, draft });
    expect(await l.lookup(NUTELLA)).toEqual({ kind: 'not_found', gtin: NUTELLA_14, draft });
    expect(calls.invoke).toHaveLength(1);
    expect(calls.select).toHaveLength(1);
    now += 61_000;
    await l.lookup(NUTELLA);
    expect(calls.invoke).toHaveLength(2);
    l.reset();
    await l.lookup(NUTELLA);
    expect(calls.invoke).toHaveLength(3);
  });

  it('returns offline without queuing anything when the device is offline', async () => {
    const { client, calls } = fakeClient();
    const l = createCatalogueLookup({ client, lookupLocal: noLocal, isOnline: () => false });
    expect(await l.lookup(NUTELLA)).toEqual({ kind: 'offline', gtin: NUTELLA_14 });
    expect(calls.select).toEqual([]);
  });

  it('treats a transport failure of the select as offline', async () => {
    const { client, calls } = fakeClient({
      select: () => ({ data: null, error: { message: 'TypeError: Load failed', code: '' }, status: 0 }),
    });
    const l = createCatalogueLookup({ client, lookupLocal: noLocal, isOnline: () => true });
    expect(await l.lookup(NUTELLA)).toEqual({ kind: 'offline', gtin: NUTELLA_14 });
    expect(calls.invoke).toEqual([]);
  });

  it('treats a network failure of the function as offline', async () => {
    const { client } = fakeClient({
      invoke: () => ({ data: null, error: { name: 'FunctionsFetchError', context: new TypeError('Load failed') } }),
    });
    const l = createCatalogueLookup({ client, lookupLocal: noLocal, isOnline: () => true });
    expect(await l.lookup(NUTELLA)).toEqual({ kind: 'offline', gtin: NUTELLA_14 });
  });

  it('a server error on the select still tries the function', async () => {
    const { client, calls } = fakeClient({
      select: () => ({ data: null, error: { message: 'boom', code: '57014' }, status: 500 }),
    });
    const l = createCatalogueLookup({ client, lookupLocal: noLocal, isOnline: () => true });
    expect(await l.lookup(NUTELLA)).toMatchObject({ kind: 'not_found' });
    expect(calls.invoke).toHaveLength(1);
  });

  it('maps 429 and 503 to lookup_unavailable, honours Retry-After, and never caches them as not found', async () => {
    let now = 0;
    let status = 429;
    const { client, calls } = fakeClient({
      invoke: () => httpError(status, { outcome: 'error', code: 'rate_limited', retryAfter: 30 }),
    });
    const l = createCatalogueLookup({ client, lookupLocal: noLocal, isOnline: () => true, now: () => now });
    expect(await l.lookup(NUTELLA)).toEqual({ kind: 'lookup_unavailable', gtin: NUTELLA_14, retryAfter: 30 });
    now = 10_000;
    expect(await l.lookup(NUTELLA)).toEqual({ kind: 'lookup_unavailable', gtin: NUTELLA_14, retryAfter: 20 });
    expect(calls.invoke).toHaveLength(1);
    now = 31_000;
    status = 503;
    expect(await l.lookup(NUTELLA)).toMatchObject({ kind: 'lookup_unavailable', retryAfter: 30 });
    expect(calls.invoke).toHaveLength(2);
  });

  it('refreshes the session once on 401', async () => {
    let first = true;
    const { client, calls } = fakeClient({
      invoke: () => {
        if (first) {
          first = false;
          return httpError(401, { msg: 'Invalid JWT' });
        }
        return { data: { outcome: 'not_found', cached: true, draft: null }, error: null };
      },
    });
    const l = createCatalogueLookup({ client, lookupLocal: noLocal, isOnline: () => true });
    expect(await l.lookup(NUTELLA)).toMatchObject({ kind: 'not_found' });
    expect(calls.refresh).toBe(1);
    expect(calls.invoke).toHaveLength(2);
  });

  it('gives up after a failed refresh', async () => {
    const { client } = fakeClient({
      invoke: () => httpError(401, {}),
      refresh: async () => ({ error: new Error('no session') }),
    });
    const l = createCatalogueLookup({ client, lookupLocal: noLocal, isOnline: () => true });
    expect(await l.lookup(NUTELLA)).toEqual({ kind: 'lookup_unavailable', gtin: NUTELLA_14, retryAfter: null });
  });

  it('shares one request between concurrent lookups of the same code', async () => {
    const { client, calls } = fakeClient();
    const l = createCatalogueLookup({ client, lookupLocal: noLocal, isOnline: () => true });
    await Promise.all([l.lookup(NUTELLA), l.lookup(NUTELLA)]);
    expect(calls.select).toHaveLength(1);
  });

  it('a broken local store does not block the lookup', async () => {
    const { client } = fakeClient({ select: () => ({ data: row(), error: null, status: 200 }) });
    const l = createCatalogueLookup({
      client,
      lookupLocal: () => {
        throw new Error('idb closed');
      },
      isOnline: () => true,
    });
    expect(await l.lookup(NUTELLA)).toMatchObject({ kind: 'found_catalogue' });
  });

  it('rejects when the caller aborts', async () => {
    const { client } = fakeClient();
    const l = createCatalogueLookup({ client, lookupLocal: noLocal, isOnline: () => true });
    const c = new AbortController();
    c.abort();
    await expect(l.lookup(NUTELLA, { signal: c.signal })).rejects.toBeDefined();
  });
});

describe('searchCatalog', () => {
  it('requires 3 characters and is unavailable offline', async () => {
    const { client, calls } = fakeClient();
    expect(await searchCatalog('  ab ', { client, isOnline: () => true })).toEqual({ kind: 'too_short', query: 'ab' });
    expect(await searchCatalog('pates', { client, isOnline: () => false })).toEqual({
      kind: 'offline',
      query: 'pates',
    });
    expect(calls.rpc).toEqual([]);
  });

  it('maps rows and de-duplicates by GTIN', async () => {
    const { client, calls } = fakeClient({
      rpc: async () => ({
        data: [row(), row(), row({ gtin: '00000073513537', name: 'Autre' })],
        error: null,
        status: 200,
      }),
    });
    const res = await searchCatalog('  pâte   à tartiner ', { client, isOnline: () => true });
    expect(calls.rpc).toEqual(['pâte à tartiner']);
    expect(res.kind === 'ok' && res.products.map((p) => p.name)).toEqual(['Pâte à tartiner', 'Autre']);
  });

  it('reports errors and network failures', async () => {
    const failing = fakeClient({ rpc: async () => ({ data: null, error: { message: 'boom' }, status: 500 }) });
    expect((await searchCatalog('pates', { client: failing.client, isOnline: () => true })).kind).toBe('error');
    const offline = fakeClient({ rpc: async () => ({ data: null, error: { message: 'TypeError: x' }, status: 0 }) });
    expect((await searchCatalog('pates', { client: offline.client, isOnline: () => true })).kind).toBe('offline');
  });

  it('the searcher aborts the previous request', async () => {
    const signals: AbortSignal[] = [];
    const { client } = fakeClient({
      rpc: (_args, signal) => {
        signals.push(signal);
        return new Promise((resolve) => setTimeout(() => resolve({ data: [row()], error: null, status: 200 }), 5));
      },
    });
    const s = createCatalogSearcher({ client, isOnline: () => true });
    const first = s.search('pates');
    const second = s.search('pates fraiches');
    expect((await first).kind).toBe('aborted');
    expect((await second).kind).toBe('ok');
    expect(signals[0]?.aborted).toBe(true);
  });
});

describe('catalogueToProductCreate', () => {
  const categories: Pick<Category, 'id' | 'templateKey' | 'deletedAt'>[] = [
    { id: 'c-pdj' as CategoryId, templateKey: 'petit_dej', deletedAt: null },
    { id: 'c-autre' as CategoryId, templateKey: 'autre', deletedAt: null },
    { id: 'c-cafe' as CategoryId, templateKey: 'cafe', deletedAt: '2026-01-01T00:00:00Z' },
  ];
  const NOW = Date.parse('2026-11-10T12:00:00Z');

  it('builds the product.create payload', () => {
    const { args, categoryKey } = catalogueToProductCreate(product(), {
      productId: 'p-new' as ProductId,
      categories,
      now: NOW,
    });
    expect(categoryKey).toBe('petit_dej');
    expect(args).toEqual({
      productId: 'p-new',
      name: 'Pâte à tartiner',
      brand: 'Nutella',
      gtin: NUTELLA_14,
      catalogGtin: NUTELLA_14,
      categoryId: 'c-pdj',
      netQuantity: 400,
      netUnit: 'g',
      packCount: 1,
      imageUrl: 'https://images.openfoodfacts.org/x.jpg',
      priceCents: 389,
      priceSource: 'catalog',
    });
  });

  it('falls back to autre, then to no category', () => {
    expect(resolveHouseholdCategory(categories, 'cafe')).toBe('c-autre');
    expect(resolveHouseholdCategory(categories, null)).toBe('c-autre');
    expect(resolveHouseholdCategory(categories.slice(0, 1), 'vin')).toBeNull();
  });

  it('drops prices older than a year', () => {
    expect(displayablePriceCents(product({ priceObservedOn: '2025-11-01' }), NOW)).toBeNull();
    const { args } = catalogueToProductCreate(product({ priceObservedOn: '2025-01-01' }), {
      productId: 'p' as ProductId,
      categories,
      now: NOW,
    });
    expect([args.priceCents, args.priceSource]).toEqual([null, null]);
  });
});
