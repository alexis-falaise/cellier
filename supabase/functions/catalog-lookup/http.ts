/** CORS and JSON answers, section 6.4. */
import type { CatalogLookupErrorCode, CatalogLookupResponse } from './types.ts';

export const LOCALHOST_ORIGIN = 'http://localhost:5173';

export interface CorsConfig {
  /** CELLIER_APP_URL. */
  appUrl?: string;
  /** CELLIER_ALLOWED_ORIGINS, comma-separated. */
  extraOrigins?: string;
  /** CELLIER_ALLOW_LOCALHOST === '1'. */
  allowLocalhost?: boolean;
}

function originOf(url: string): string | null {
  try {
    const u = new URL(url.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null;
  } catch {
    return null;
  }
}

export function allowedOrigins(cfg: CorsConfig): Set<string> {
  const out = new Set<string>();
  for (const raw of [cfg.appUrl ?? '', ...(cfg.extraOrigins ?? '').split(',')]) {
    if (raw.trim() === '' || raw.includes('*')) continue; // never a wildcard
    const o = originOf(raw);
    if (o) out.add(o);
  }
  if (cfg.allowLocalhost) out.add(LOCALHOST_ORIGIN);
  return out;
}

/** CORS headers for this request's Origin; no Allow-Origin header when the origin is not allowed. */
export function corsHeaders(origin: string | null, allowed: Set<string>): Record<string, string> {
  const h: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
  if (origin && allowed.has(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

export function json(
  status: number,
  body: CatalogLookupResponse | Record<string, unknown>,
  cors: Record<string, string>,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extra,
    },
  });
}

export function errorResponse(
  status: number,
  code: CatalogLookupErrorCode,
  message: string,
  cors: Record<string, string>,
  retryAfter?: number,
): Response {
  const body: CatalogLookupResponse = retryAfter === undefined
    ? { outcome: 'error', code, message }
    : { outcome: 'error', code, retryAfter, message };
  return json(status, body, cors, retryAfter === undefined ? {} : { 'Retry-After': String(retryAfter) });
}
