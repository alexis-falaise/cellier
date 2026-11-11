/**
 * Edge Function `product-facts`: grades, nutrition and composition of one product, from the
 * `public.catalog_facts` cache or, when absent or stale, from the Open Food Facts family
 * (universal endpoint, so food, beauty, household and pet products all answer).
 *
 * Request:  POST {"gtin": "03017620422003"}  (user access token required)
 * Answer:   200 {outcome: 'ok', facts: CatalogFactsRow, cached: boolean, stale?: true}
 *           4xx/5xx {outcome: 'error', code, retryAfter?}
 * When upstream is unavailable or the user is rate-limited, a stale cached row is returned with
 * `stale: true` rather than an error.
 *
 * Rate limiting and the global upstream budget are shared with catalog-lookup
 * (public.catalog_lookup_gate). A cache hit never consumes the budget.
 *
 * Secrets / environment: as catalog-lookup (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * CATALOGUE_CONTACT, CELLIER_APP_URL, CELLIER_ALLOWED_ORIGINS, CELLIER_ALLOW_LOCALHOST).
 * config.toml: [functions.product-facts] verify_jwt = true.
 */
import { createClient } from '@supabase/supabase-js';
import { allowedOrigins, corsHeaders, json } from '../catalog-lookup/http.ts';
import { parseRequestGtin } from '../catalog-lookup/request-gtin.ts';
import { parseGate } from '../catalog-lookup/row.ts';
import { CATALOG_LOOKUP_LIMITS as LIMITS } from '../catalog-lookup/types.ts';
import { lookupUpstream } from '../catalog-lookup/upstream.ts';
import { type CatalogFactsRow, FACTS_FIELDS, isFresh, normaliseFacts, notFoundFacts } from './facts.ts';

const FUNCTION_VERSION = '0.1.0';
const env = (name: string) => Deno.env.get(name) ?? undefined;

const ALLOWED = allowedOrigins({
  appUrl: env('CELLIER_APP_URL'),
  extraOrigins: env('CELLIER_ALLOWED_ORIGINS'),
  allowLocalhost: env('CELLIER_ALLOW_LOCALHOST') === '1',
});
const CONTACT = env('CATALOGUE_CONTACT')?.trim();
const USER_AGENT = CONTACT ? `Cellier/${FUNCTION_VERSION} (${CONTACT})` : `Cellier/${FUNCTION_VERSION}`;

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const COLUMNS =
  'gtin,found,source,nutriscore_grade,nova_group,ecoscore_grade,nutriments,nutrient_levels,ingredients_text,' +
  'allergens,traces,additives,labels,analysis,origins,period_after_opening_months,source_modified_at,fetched_at';

function fail(status: number, code: string, cors: Record<string, string>, retryAfter?: number) {
  const body = retryAfter === undefined ? { outcome: 'error', code } : { outcome: 'error', code, retryAfter };
  return json(status, body, cors, retryAfter === undefined ? {} : { 'Retry-After': String(retryAfter) });
}

function log(started: number, line: Record<string, unknown>) {
  console.log(JSON.stringify({ fn: 'product-facts', ...line, ms: Date.now() - started }));
}

async function store(row: CatalogFactsRow): Promise<CatalogFactsRow> {
  const { data, error } = await supabase
    .from('catalog_facts')
    .upsert({ ...row, fetched_at: new Date().toISOString() }, { onConflict: 'gtin' })
    .select(COLUMNS)
    .single();
  if (error) throw new Error(`upsert: ${error.message}`);
  return data as unknown as CatalogFactsRow;
}

Deno.serve(async (req) => {
  const started = Date.now();
  const deadline = started + LIMITS.totalBudgetMs;
  const cors = corsHeaders(req.headers.get('origin'), ALLOWED);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'Cache-Control': 'no-store' } });
  if (req.method !== 'POST') return fail(405, 'method_not_allowed', cors);

  const auth = req.headers.get('authorization') ?? '';
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  const { data: userData, error: userError } = token ? await supabase.auth.getUser(token) : { data: null, error: true };
  const user = userData?.user;
  if (userError || !user || user.is_anonymous) return fail(401, 'unauthorized', cors);

  let gtinInput: unknown;
  try {
    const text = await req.text();
    if (text.length > LIMITS.maxBodyBytes) return fail(413, 'payload_too_large', cors);
    gtinInput = (JSON.parse(text) as { gtin?: unknown } | null)?.gtin;
  } catch {
    gtinInput = undefined;
  }
  if (typeof gtinInput !== 'string') return fail(400, 'invalid_request', cors);
  const parsed = parseRequestGtin(gtinInput);
  if (!parsed.ok) return fail(400, parsed.code, cors);
  const { gtin, offCode } = parsed;

  try {
    // 1. Cache.
    const { data: cachedData, error: cacheError } = await supabase
      .from('catalog_facts')
      .select(COLUMNS)
      .eq('gtin', gtin)
      .maybeSingle();
    if (cacheError) throw new Error(`select: ${cacheError.message}`);
    const cached = cachedData as unknown as CatalogFactsRow | null;
    if (cached && isFresh(cached, Date.now())) {
      log(started, { gtin, outcome: 'cache_hit' });
      return json(200, { outcome: 'ok', facts: cached, cached: true }, cors);
    }
    const staleOr = (status: number, code: string, retryAfter?: number) => {
      if (cached) return json(200, { outcome: 'ok', facts: cached, cached: true, stale: true }, cors);
      return fail(status, code, cors, retryAfter);
    };

    // 2. Gate (shared with catalog-lookup).
    const { data: gateData, error: gateError } = await supabase.rpc('catalog_lookup_gate', { p_user: user.id, p_gtin: gtin });
    if (gateError) throw new Error(`gate: ${gateError.message}`);
    const gate = parseGate(gateData);
    if (!gate) throw new Error('gate: malformed answer');
    if (gate.decision === 'rate_limited') {
      log(started, { gtin, outcome: 'rate_limited' });
      return staleOr(429, 'rate_limited', gate.retryAfter);
    }
    if (gate.decision === 'upstream_budget_exhausted') {
      log(started, { gtin, outcome: 'upstream_budget_exhausted' });
      return staleOr(503, 'upstream_unavailable', gate.retryAfter);
    }
    if (gate.decision === 'cached_miss') {
      const row = await store(notFoundFacts(gtin));
      log(started, { gtin, outcome: 'not_found_cached' });
      return json(200, { outcome: 'ok', facts: row, cached: false }, cors);
    }

    // 3. Upstream.
    const { result, status, usedFallback } = await lookupUpstream(offCode, USER_AGENT, deadline, LIMITS, undefined, FACTS_FIELDS);
    if (result.kind === 'unavailable') {
      log(started, { gtin, outcome: 'upstream_unavailable', upstreamStatus: status, fallback: usedFallback });
      return staleOr(503, 'upstream_unavailable', 60);
    }
    if (result.kind === 'invalid') {
      log(started, { gtin, outcome: 'upstream_invalid', upstreamStatus: status, fallback: usedFallback });
      return staleOr(502, 'upstream_invalid');
    }
    const row = await store(
      result.kind === 'not_found' ? notFoundFacts(gtin) : normaliseFacts(gtin, result.record, result.source),
    );
    log(started, { gtin, outcome: result.kind, source: row.source, upstreamStatus: status, fallback: usedFallback });
    return json(200, { outcome: 'ok', facts: row, cached: false }, cors);
  } catch (e) {
    log(started, { gtin, outcome: 'internal', error: e instanceof Error ? e.message : String(e) });
    return fail(500, 'internal', cors);
  }
});
