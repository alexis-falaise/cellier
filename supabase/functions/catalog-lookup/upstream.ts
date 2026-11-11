/** Open Food Facts product call and interpretation of its answer, section 6.3 steps 5-6. */
import { sourceFromProductType, sourceFromUrl } from './normalise.ts';
import { OFF_FIELDS, type OffRecord, type UpstreamSource } from './types.ts';

export const PRIMARY_HOST = 'https://world.openfoodfacts.org';
export const FALLBACK_HOST = 'https://world.openproductsfacts.org';

export type UpstreamResult =
  | { kind: 'found'; record: OffRecord; source: UpstreamSource }
  | { kind: 'not_found' }
  /** 429, 5xx, network error or timeout: try the fallback host, else 503. */
  | { kind: 'unavailable'; status: number | null }
  /** Any other answer or an unparseable body: 502. */
  | { kind: 'invalid'; status: number };

export function productUrl(host: string, offCode: string, fields: string = OFF_FIELDS): string {
  return `${host}/api/v3/product/${encodeURIComponent(offCode)}?product_type=all&fields=${fields}`;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function hasInvalidCodeError(body: Record<string, unknown>): boolean {
  const errors = Array.isArray(body.errors) ? body.errors : [];
  return errors.some((e) => isObject(e) && isObject(e.message) && e.message.id === 'invalid_code');
}

/** Pure: interprets one HTTP answer (status, raw body, URL after redirects). */
export function interpretUpstream(status: number, bodyText: string, finalUrl: string): UpstreamResult {
  if (status === 429 || status >= 500) return { kind: 'unavailable', status };

  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return { kind: 'invalid', status };
  }
  if (!isObject(body)) return { kind: 'invalid', status };
  const result = isObject(body.result) ? body.result : {};

  if (status === 200) {
    const okStatus = body.status === 'success' || body.status === 'success_with_warnings';
    if (okStatus && result.id === 'product_found' && isObject(body.product)) {
      const record = body.product as OffRecord;
      const source = sourceFromProductType(record.product_type) ?? sourceFromUrl(finalUrl) ?? 'off';
      return { kind: 'found', record, source };
    }
    return { kind: 'invalid', status };
  }

  if (status === 404 && body.status === 'failure') {
    if (result.id === 'product_not_found' || hasInvalidCodeError(body)) return { kind: 'not_found' };
  }
  return { kind: 'invalid', status };
}

/** One GET with its own timeout; never throws. */
export async function fetchProduct(
  host: string,
  offCode: string,
  userAgent: string,
  timeoutMs: number,
  fields: string = OFF_FIELDS,
): Promise<UpstreamResult & { ms: number }> {
  const started = Date.now();
  try {
    const res = await fetch(productUrl(host, offCode, fields), {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': userAgent, Accept: 'application/json' },
      signal: AbortSignal.timeout(Math.max(1, timeoutMs)),
    });
    const text = await res.text();
    return { ...interpretUpstream(res.status, text, res.url), ms: Date.now() - started };
  } catch {
    // Network error, DNS failure or timeout (the abort also covers reading the body).
    return { kind: 'unavailable', status: null, ms: Date.now() - started };
  }
}

/**
 * Primary host, then the fallback host once if the first was unavailable and enough of the
 * total budget remains (section 6.5). `deadline` is an absolute Date.now() value.
 */
export async function lookupUpstream(
  offCode: string,
  userAgent: string,
  deadline: number,
  limits: { upstreamTimeoutMs: number; fallbackMinBudgetMs: number },
  fetcher: typeof fetchProduct = fetchProduct,
  fields: string = OFF_FIELDS,
): Promise<{ result: UpstreamResult; status: number | null; usedFallback: boolean }> {
  const firstTimeout = Math.min(limits.upstreamTimeoutMs, deadline - Date.now());
  const first = await fetcher(PRIMARY_HOST, offCode, userAgent, firstTimeout, fields);
  if (first.kind !== 'unavailable') return { result: first, status: statusOf(first), usedFallback: false };

  const remaining = deadline - Date.now();
  if (remaining < limits.fallbackMinBudgetMs) return { result: first, status: first.status, usedFallback: false };
  const second = await fetcher(FALLBACK_HOST, offCode, userAgent, Math.min(limits.upstreamTimeoutMs, remaining), fields);
  return { result: second, status: statusOf(second), usedFallback: true };
}

function statusOf(r: UpstreamResult): number | null {
  if (r.kind === 'found') return 200;
  if (r.kind === 'not_found') return 404;
  return r.status;
}
