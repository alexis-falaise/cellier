/**
 * Edge Function `scan-receipt` — reads a photo of a supermarket receipt with Claude (vision) and
 * returns its lines: label, readable name, quantity, unit price paid, and the household product each
 * line matches. The client reviews the lines, lets the member pick a cellier per line, then writes
 * one priced `stock.add` per line (the price history lives on those restocks).
 *
 * Request:  { image: { mediaType: 'image/jpeg' | 'image/png' | 'image/webp', data: base64 },
 *             products: [{ id, name, brand?, kind? }] (≤ 800) }
 * Response: { outcome: 'ok', model, receipt: { store, purchasedOn, totalCents, lines: [...] } }
 *
 * Secrets / environment:
 * - ANTHROPIC_API_KEY: Edge Function secret. Never shipped to the browser.
 * - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: injected by the platform (used to resolve the user).
 * - CELLIER_APP_URL, CELLIER_ALLOWED_ORIGINS, CELLIER_ALLOW_LOCALHOST: CORS, as for catalog-lookup.
 *
 * config.toml: [functions.scan-receipt] verify_jwt = true.
 */
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { allowedOrigins, corsHeaders, json } from '../catalog-lookup/http.ts';
import { OUTPUT_SCHEMA, parseRequest, productsMessage, SYSTEM_PROMPT, validateResult } from './prompt.ts';

const MODEL = 'claude-opus-5-5';
/** A base64 photo of up to ≈ 6 MB plus the product list. */
const MAX_BODY_BYTES = 8_500_000;

const env = (name: string) => Deno.env.get(name) ?? undefined;

const ALLOWED = allowedOrigins({
  appUrl: env('CELLIER_APP_URL'),
  extraOrigins: env('CELLIER_ALLOWED_ORIGINS'),
  allowLocalhost: env('CELLIER_ALLOW_LOCALHOST') === '1',
});

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const API_KEY = env('ANTHROPIC_API_KEY');
const anthropic = API_KEY ? new Anthropic({ apiKey: API_KEY, timeout: 90_000, maxRetries: 1 }) : null;

function fail(status: number, code: string, message: string, cors: Record<string, string>) {
  return json(status, { outcome: 'error', code, message }, cors);
}

function log(started: number, line: Record<string, unknown>) {
  console.log(JSON.stringify({ fn: 'scan-receipt', ...line, ms: Date.now() - started }));
}

Deno.serve(async (req) => {
  const started = Date.now();
  const cors = corsHeaders(req.headers.get('origin'), ALLOWED);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'Cache-Control': 'no-store' } });
  if (req.method !== 'POST') return fail(405, 'method_not_allowed', 'Only POST is allowed', cors);
  if (!anthropic) return fail(503, 'not_configured', 'ANTHROPIC_API_KEY is not set', cors);

  const auth = req.headers.get('authorization') ?? '';
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  const { data: userData, error: userError } = token ? await supabase.auth.getUser(token) : { data: null, error: true };
  const user = userData?.user;
  if (userError || !user || user.is_anonymous) return fail(401, 'unauthorized', 'A signed-in user is required', cors);

  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return fail(413, 'payload_too_large', 'Body over 8 MB', cors);
  let parsed;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return fail(413, 'payload_too_large', 'Body over 8 MB', cors);
    parsed = parseRequest(JSON.parse(text));
  } catch {
    parsed = null;
  }
  if (!parsed) return fail(400, 'invalid_request', 'Expected {image: {mediaType, data}, products?: [{id, name}]}', cors);

  try {
    // Server-side fallbacks: a safety decline is retried on the model the API picks for its category.
    const params = {
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: productsMessage(parsed.products) },
            { type: 'image', source: { type: 'base64', media_type: parsed.image.mediaType, data: parsed.image.data } },
            { type: 'text', text: 'Voici le ticket de caisse.' },
          ],
        },
      ],
    } as unknown as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
    const response = await anthropic.beta.messages.create(params);
    if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') {
      log(started, { outcome: 'model_stopped', stop: response.stop_reason });
      return fail(502, 'model_unavailable', `Model stopped: ${response.stop_reason}`, cors);
    }
    const text = response.content.find((b) => b.type === 'text');
    const receipt = validateResult(text?.type === 'text' ? JSON.parse(text.text) : null, parsed.products);
    log(started, {
      outcome: 'ok',
      model: response.model,
      products: parsed.products.length,
      lines: receipt.lines.length,
      matched: receipt.lines.filter((l) => l.productId).length,
      inTokens: response.usage.input_tokens,
      outTokens: response.usage.output_tokens,
    });
    return json(200, { outcome: 'ok', model: response.model, receipt }, cors);
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) {
      log(started, { outcome: 'rate_limited' });
      return fail(429, 'rate_limited', 'Model rate limit reached', cors);
    }
    if (e instanceof Anthropic.AuthenticationError) {
      log(started, { outcome: 'bad_api_key' });
      return fail(503, 'not_configured', 'ANTHROPIC_API_KEY was rejected', cors);
    }
    if (e instanceof Anthropic.BadRequestError) {
      log(started, { outcome: 'bad_request', error: e.message });
      return fail(422, 'unreadable_image', 'The photo could not be read', cors);
    }
    const status = e instanceof Anthropic.APIError ? e.status : undefined;
    log(started, { outcome: 'error', status, error: e instanceof Error ? e.message : String(e) });
    return fail(502, 'model_unavailable', 'The receipt reader is unavailable', cors);
  }
});
