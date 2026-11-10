import { assertEquals } from '@std/assert';
import { interpretUpstream, lookupUpstream, PRIMARY_HOST, FALLBACK_HOST, productUrl, type UpstreamResult } from './upstream.ts';
import { selectPrice } from './prices.ts';
import { allowedOrigins, corsHeaders, LOCALHOST_ORIGIN } from './http.ts';
import { parseGate } from './row.ts';

const raw = (f: string) => Deno.readTextFileSync(new URL(`./fixtures/${f}`, import.meta.url));
const OFF = 'https://world.openfoodfacts.org/api/v3/product/x';
const OPF = 'https://world.openproductsfacts.org/api/v3/product/x';

Deno.test('interpretUpstream: found (food and redirected non-food)', () => {
  const r = interpretUpstream(200, raw('off-nutella.json'), OFF);
  assertEquals(r.kind, 'found');
  assertEquals(r.kind === 'found' && r.source, 'off');
  const lc = interpretUpstream(200, raw('off-lechat.json'), OPF);
  assertEquals(lc.kind === 'found' && lc.source, 'opf');
  // success_with_warnings, no product_type: source from the host that answered
  const nl = interpretUpstream(200, raw('off-nameless.json'), OPF);
  assertEquals(nl.kind === 'found' && nl.source, 'opf');
});

Deno.test('interpretUpstream: not found and invalid code (HTTP 404)', () => {
  assertEquals(interpretUpstream(404, raw('off-not-found.json'), OFF), { kind: 'not_found' });
  assertEquals(interpretUpstream(404, raw('off-invalid-code.json'), OFF), { kind: 'not_found' });
});

Deno.test('interpretUpstream: unavailable and invalid', () => {
  assertEquals(interpretUpstream(429, '', OFF), { kind: 'unavailable', status: 429 });
  assertEquals(interpretUpstream(503, '<html>', OFF), { kind: 'unavailable', status: 503 });
  assertEquals(interpretUpstream(200, '<html>', OFF), { kind: 'invalid', status: 200 });
  assertEquals(interpretUpstream(200, '{"status":"failure"}', OFF), { kind: 'invalid', status: 200 });
  assertEquals(interpretUpstream(404, 'Not Found', OFF), { kind: 'invalid', status: 404 });
  assertEquals(interpretUpstream(403, '{}', OFF), { kind: 'invalid', status: 403 });
  assertEquals(interpretUpstream(200, '[]', OFF), { kind: 'invalid', status: 200 });
});

Deno.test('productUrl', () => {
  const u = new URL(productUrl(PRIMARY_HOST, '3017620422003'));
  assertEquals(u.pathname, '/api/v3/product/3017620422003');
  assertEquals(u.searchParams.get('product_type'), 'all');
  assertEquals(u.searchParams.get('fields')?.split(',').includes('food_groups_tags'), true);
});

Deno.test('lookupUpstream: fallback once when budget allows', async () => {
  const calls: string[] = [];
  const fake = (results: UpstreamResult[]) => (host: string) => {
    calls.push(host);
    return Promise.resolve({ ...results[calls.length - 1], ms: 1 });
  };
  const limits = { upstreamTimeoutMs: 4500, fallbackMinBudgetMs: 2500 };
  let r = await lookupUpstream('1', 'UA', Date.now() + 7000, limits, fake([{ kind: 'unavailable', status: 503 }, { kind: 'not_found' }]));
  assertEquals([r.result.kind, r.usedFallback, calls], ['not_found', true, [PRIMARY_HOST, FALLBACK_HOST]]);
  calls.length = 0;
  r = await lookupUpstream('1', 'UA', Date.now() + 1000, limits, fake([{ kind: 'unavailable', status: null }]));
  assertEquals([r.result.kind, r.usedFallback, calls.length], ['unavailable', false, 1]);
  calls.length = 0;
  r = await lookupUpstream('1', 'UA', Date.now() + 7000, limits, fake([{ kind: 'invalid', status: 200 }]));
  assertEquals([r.result.kind, calls.length], ['invalid', 1]);
});

Deno.test('selectPrice: fixture (filters, outlier, chain preference)', () => {
  const items = JSON.parse(raw('prices-sample.json')).items;
  assertEquals(selectPrice(items, '2026-11-10'), { priceCents: 379, priceObservedOn: '2026-11-01', priceChain: 'leclerc' });
});

Deno.test('selectPrice: single old observation is not used; bounds; future dates', () => {
  const base = { type: 'PRODUCT', price_is_discounted: false, price_per: null, currency: 'EUR', duplicate_of: null, location: { osm_brand: 'Super U', osm_address_country_code: 'FR' } };
  assertEquals(selectPrice([{ ...base, price: 2, date: '2025-06-01' }], '2026-11-10'), null);
  assertEquals(selectPrice([{ ...base, price: 2, date: '2026-06-01' }], '2026-11-10'), { priceCents: 200, priceObservedOn: '2026-06-01', priceChain: 'other' });
  assertEquals(selectPrice([{ ...base, price: 0.01, date: '2026-11-01' }], '2026-11-10'), null);
  assertEquals(selectPrice([{ ...base, price: 2, date: '2026-12-01' }], '2026-11-10'), null);
  assertEquals(selectPrice([], '2026-11-10'), null);
});

Deno.test('CORS: allowed origins, never *', () => {
  const allowed = allowedOrigins({
    appUrl: 'https://cellier-one.vercel.app/',
    extraOrigins: 'https://cellier-git-x.vercel.app, *, not a url',
    allowLocalhost: false,
  });
  assertEquals([...allowed].sort(), ['https://cellier-git-x.vercel.app', 'https://cellier-one.vercel.app']);
  assertEquals(corsHeaders('https://cellier-one.vercel.app', allowed)['Access-Control-Allow-Origin'], 'https://cellier-one.vercel.app');
  assertEquals(corsHeaders('https://evil.example', allowed)['Access-Control-Allow-Origin'], undefined);
  assertEquals(corsHeaders(LOCALHOST_ORIGIN, allowed)['Access-Control-Allow-Origin'], undefined);
  const dev = allowedOrigins({ appUrl: 'https://cellier-one.vercel.app', allowLocalhost: true });
  assertEquals(corsHeaders(LOCALHOST_ORIGIN, dev)['Access-Control-Allow-Origin'], LOCALHOST_ORIGIN);
  assertEquals(corsHeaders('http://localhost:5174', dev)['Access-Control-Allow-Origin'], undefined);
  assertEquals(corsHeaders(null, dev).Vary, 'Origin');
});

Deno.test('parseGate', () => {
  assertEquals(parseGate({ decision: 'admit', catalogueFull: false }), { decision: 'admit', catalogueFull: false });
  assertEquals(parseGate({ decision: 'rate_limited', retryAfter: 42 }), { decision: 'rate_limited', retryAfter: 42 });
  assertEquals(parseGate({ decision: 'upstream_budget_exhausted', retryAfter: 60 }), { decision: 'upstream_budget_exhausted', retryAfter: 60 });
  assertEquals(parseGate({ decision: 'cached_miss' }), { decision: 'cached_miss' });
  assertEquals(parseGate({ decision: 'nope' }), null);
  assertEquals(parseGate(null), null);
});
