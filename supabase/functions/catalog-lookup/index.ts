/**
 * Edge Function `catalog-lookup` — docs/architecture/05-catalogue.md section 6.
 *
 * Secrets / environment:
 * - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: injected by the platform.
 * - CATALOGUE_CONTACT: contact address for the Open Food Facts User-Agent (Edge Function secret).
 * - CELLIER_APP_URL: production app origin (CORS).
 * - CELLIER_ALLOWED_ORIGINS: optional comma-separated extra origins (preview deployments).
 * - CELLIER_ALLOW_LOCALHOST=1: optionally allow exactly http://localhost:5173.
 *
 * config.toml: [functions.catalog-lookup] verify_jwt = true.
 */
import { createClient } from '@supabase/supabase-js';
import { allowedOrigins, corsHeaders, errorResponse, json } from './http.ts';
import { normalise } from './normalise.ts';
import { fetchPrice, type PriceChoice } from './prices.ts';
import { parseRequestGtin } from './request-gtin.ts';
import { parseGate, toCatalogProduct, toUpsertRow } from './row.ts';
import {
  CATALOG_LOOKUP_LIMITS as LIMITS,
  CATALOG_SELECT_COLUMNS,
  type CatalogLookupResponse,
  type CatalogProductRow,
} from './types.ts';
import { lookupUpstream } from './upstream.ts';

const FUNCTION_VERSION = '0.1.0';

const env = (name: string) => Deno.env.get(name) ?? undefined;

const ALLOWED = allowedOrigins({
  appUrl: env('CELLIER_APP_URL'),
  extraOrigins: env('CELLIER_ALLOWED_ORIGINS'),
  allowLocalhost: env('CELLIER_ALLOW_LOCALHOST') === '1',
});

const CONTACT = env('CATALOGUE_CONTACT')?.trim();
const USER_AGENT = CONTACT ? `Cellier/${FUNCTION_VERSION} (${CONTACT})` : `Cellier/${FUNCTION_VERSION}`;
if (!CONTACT) console.warn(JSON.stringify({ fn: 'catalog-lookup', warn: 'CATALOGUE_CONTACT secret is not set' }));

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

async function hashUser(id: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id));
  return Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Reads at most `max` bytes; null when the body is larger. */
async function readLimited(req: Request, max: number): Promise<string | null> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > max) return null;
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

interface LogLine {
  user?: string;
  gtin?: string;
  outcome: string;
  upstreamStatus?: number | null;
  fallback?: boolean;
  persisted?: boolean;
  error?: string;
}

function log(started: number, line: LogLine) {
  console.log(JSON.stringify({ fn: 'catalog-lookup', ...line, ms: Date.now() - started }));
}

Deno.serve(async (req) => {
  const started = Date.now();
  const deadline = started + LIMITS.totalBudgetMs;
  const cors = corsHeaders(req.headers.get('origin'), ALLOWED);

  // 1. Method, size, body.
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'Cache-Control': 'no-store' } });
  if (req.method !== 'POST') {
    return errorResponse(405, 'method_not_allowed', 'Only POST is allowed', { ...cors, Allow: 'POST, OPTIONS' });
  }

  // Authentication: the gateway verified the JWT (verify_jwt = true); resolve the user here.
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  if (!token) return json(401, { outcome: 'error', code: 'unauthorized', message: 'Missing bearer token' }, cors);
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user || user.role === 'anon' || user.is_anonymous) {
    return json(401, { outcome: 'error', code: 'unauthorized', message: 'A signed-in user is required' }, cors);
  }
  const userHash = await hashUser(user.id);

  let text: string | null;
  try {
    text = await readLimited(req, LIMITS.maxBodyBytes);
  } catch {
    return errorResponse(400, 'invalid_request', 'Body could not be read', cors);
  }
  if (text === null) return errorResponse(413, 'payload_too_large', 'Body over 1 KiB', cors);
  let gtinInput: unknown;
  try {
    gtinInput = (JSON.parse(text) as { gtin?: unknown } | null)?.gtin;
  } catch {
    gtinInput = undefined;
  }
  if (typeof gtinInput !== 'string') return errorResponse(400, 'invalid_request', 'Expected {"gtin": string}', cors);

  // 2. Parse.
  const parsed = parseRequestGtin(gtinInput);
  if (!parsed.ok) {
    log(started, { user: userHash, outcome: parsed.code });
    return errorResponse(400, parsed.code, parsed.code === 'restricted_gtin' ? 'Restricted circulation number' : 'Invalid GTIN', cors);
  }
  const { gtin, offCode } = parsed;

  try {
    // 3. Gate.
    const { data: gateData, error: gateError } = await supabase.rpc('catalog_lookup_gate', { p_user: user.id, p_gtin: gtin });
    if (gateError) throw new Error(`gate: ${gateError.message}`);
    const gate = parseGate(gateData);
    if (!gate) throw new Error('gate: malformed answer');
    if (gate.decision === 'rate_limited') {
      log(started, { user: userHash, gtin, outcome: 'rate_limited' });
      return errorResponse(429, 'rate_limited', 'Per-user lookup limit reached', cors, gate.retryAfter);
    }
    if (gate.decision === 'upstream_budget_exhausted') {
      log(started, { user: userHash, gtin, outcome: 'upstream_budget_exhausted' });
      return errorResponse(503, 'upstream_unavailable', 'Global upstream budget used', cors, gate.retryAfter);
    }
    if (gate.decision === 'cached_miss') {
      log(started, { user: userHash, gtin, outcome: 'not_found_cached' });
      return json(200, { outcome: 'not_found', cached: true, draft: null } satisfies CatalogLookupResponse, cors);
    }

    // 4. Catalogue re-check.
    const existing = await selectRow(gtin);
    if (existing) {
      log(started, { user: userHash, gtin, outcome: 'found_catalogue' });
      return json(200, { outcome: 'found', origin: 'catalogue', product: existing, persisted: true } satisfies CatalogLookupResponse, cors);
    }

    // 5. Upstream product call, Open Prices in parallel.
    const priceAbort = new AbortController();
    let price: PriceChoice | null = null;
    const pricePromise = fetchPrice(offCode, USER_AGENT, LIMITS.priceTimeoutMs, priceAbort.signal).then((p) => {
      price = p;
    });

    const { result, status, usedFallback } = await lookupUpstream(offCode, USER_AGENT, deadline, LIMITS);

    // 6. Interpret.
    if (result.kind === 'unavailable') {
      priceAbort.abort();
      log(started, { user: userHash, gtin, outcome: 'upstream_unavailable', upstreamStatus: status, fallback: usedFallback });
      return errorResponse(503, 'upstream_unavailable', 'Open Food Facts is unavailable', cors, 60);
    }
    if (result.kind === 'invalid') {
      priceAbort.abort();
      log(started, { user: userHash, gtin, outcome: 'upstream_invalid', upstreamStatus: status, fallback: usedFallback });
      return errorResponse(502, 'upstream_invalid', 'Unexpected answer from Open Food Facts', cors);
    }

    // 7. Not found anywhere.
    if (result.kind === 'not_found') {
      priceAbort.abort();
      const { error } = await supabase.rpc('catalog_record_miss', { p_gtin: gtin });
      log(started, {
        user: userHash, gtin, outcome: 'not_found', upstreamStatus: status, fallback: usedFallback,
        ...(error ? { error: `record_miss: ${error.message}` } : {}),
      });
      return json(200, { outcome: 'not_found', cached: false, draft: null } satisfies CatalogLookupResponse, cors);
    }

    // 8. Found.
    const norm = normalise(result.record, result.source, gtin);
    if (!norm.ok) {
      priceAbort.abort();
      log(started, { user: userHash, gtin, outcome: 'not_found_nameless', upstreamStatus: status, fallback: usedFallback });
      return json(200, { outcome: 'not_found', cached: false, draft: norm.draft } satisfies CatalogLookupResponse, cors);
    }

    // A late price is dropped (section 6.5): use it only if it has already settled; never wait.
    priceAbort.abort();
    void pricePromise;
    const product = { ...norm.product };
    const p = price as PriceChoice | null;
    if (p) {
      product.priceCents = p.priceCents;
      product.priceObservedOn = p.priceObservedOn;
      product.priceChain = p.priceChain;
    }

    if (gate.catalogueFull) {
      log(started, { user: userHash, gtin, outcome: 'found_upstream', upstreamStatus: status, fallback: usedFallback, persisted: false });
      return json(200, { outcome: 'found', origin: 'open_food_facts', product, persisted: false } satisfies CatalogLookupResponse, cors);
    }

    const { data: stored, error: upsertError } = await supabase.rpc('catalog_upsert', {
      p_row: toUpsertRow(product, norm.categoryTags),
    });
    if (upsertError) {
      log(started, {
        user: userHash, gtin, outcome: 'found_upstream', upstreamStatus: status, fallback: usedFallback, persisted: false,
        error: `upsert: ${upsertError.message}`,
      });
      return json(200, { outcome: 'found', origin: 'open_food_facts', product, persisted: false } satisfies CatalogLookupResponse, cors);
    }
    if (stored === null) {
      // The row already exists with a newer or equal upstream timestamp (concurrent insert): return it.
      const current = await selectRow(gtin).catch(() => null);
      log(started, { user: userHash, gtin, outcome: 'found_catalogue_race', upstreamStatus: status, persisted: true });
      if (current) {
        return json(200, { outcome: 'found', origin: 'catalogue', product: current, persisted: true } satisfies CatalogLookupResponse, cors);
      }
      return json(200, { outcome: 'found', origin: 'open_food_facts', product, persisted: true } satisfies CatalogLookupResponse, cors);
    }
    log(started, { user: userHash, gtin, outcome: 'found_upstream', upstreamStatus: status, fallback: usedFallback, persisted: true });
    return json(200, {
      outcome: 'found',
      origin: 'open_food_facts',
      product: toCatalogProduct(stored as CatalogProductRow),
      persisted: true,
    } satisfies CatalogLookupResponse, cors);
  } catch (e) {
    log(started, { user: userHash, gtin, outcome: 'internal', error: e instanceof Error ? e.message : String(e) });
    return errorResponse(500, 'internal', 'Internal error', cors);
  }
});

async function selectRow(gtin: string) {
  const { data, error } = await supabase
    .from('catalog_products')
    .select(CATALOG_SELECT_COLUMNS)
    .eq('gtin', gtin)
    .maybeSingle();
  if (error) throw new Error(`select: ${error.message}`);
  return data ? toCatalogProduct(data as unknown as CatalogProductRow) : null;
}
