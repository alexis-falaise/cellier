/**
 * send-push — delivers queued notifications as Web Push (docs/architecture/04 §3.5).
 *
 * Deployed with verify_jwt = false. Called every minute by pg_net (private.kick_notification_sender)
 * with the header `x-cellier-secret`, checked through the service-role RPC
 * public.verify_internal_secret (compared against the Vault value in the database; the function
 * holds no copy of the secret). Answers 202 at once and keeps working in EdgeRuntime.waitUntil.
 *
 * Secrets: VAPID_PRIVATE_JWK, VAPID_SUBJECT, CELLIER_APP_URL. Injected: SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEYS JSON with a `default` key).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { NotificationClaimResult, NotificationCompleteReport } from './contract.ts';
import { DEFAULT_CONFIG, emptyStats, run, type PushResponse, type Sender } from './run.ts';
import { buildPushRequest, importVapidKeys, VapidSigner } from './webpush.ts';

const SEND_TIMEOUT_MS = 10_000;

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

function log(line: Record<string, unknown>) {
  console.log(JSON.stringify(line));
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function serviceKey(): string | null {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (!keys) return null;
  try {
    const parsed = JSON.parse(keys) as Record<string, string>;
    return typeof parsed.default === 'string' ? parsed.default : null;
  } catch {
    return null;
  }
}

let client: SupabaseClient | null = null;
function db(): SupabaseClient | null {
  if (client) return client;
  const url = Deno.env.get('SUPABASE_URL');
  const key = serviceKey();
  if (!url || !key) return null;
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

let signer: VapidSigner | null = null;
async function vapidSigner(): Promise<VapidSigner | null> {
  if (signer) return signer;
  const jwk = Deno.env.get('VAPID_PRIVATE_JWK');
  const subject = Deno.env.get('VAPID_SUBJECT');
  if (!jwk || !subject?.startsWith('mailto:')) return null;
  signer = new VapidSigner(await importVapidKeys(jwk), subject);
  return signer;
}

function webPushSender(s: VapidSigner): Sender {
  return async (push): Promise<PushResponse> => {
    const req = await buildPushRequest({
      signer: s,
      subscription: push.subscription,
      payload: push.payload,
      ttl: push.ttl,
      urgency: push.urgency,
      topic: push.topic,
    });
    let res: Response;
    try {
      res = await fetch(req.endpoint, {
        method: 'POST',
        headers: req.headers,
        body: req.body as BodyInit,
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
    } catch {
      return { status: null };
    }
    let reason: string | null = null;
    if (res.status >= 400 && res.status < 500) {
      try {
        const body = (await res.json()) as { reason?: unknown };
        if (typeof body?.reason === 'string') reason = body.reason.slice(0, 64);
      } catch {
        // Not JSON: no reason.
      }
    } else {
      await res.body?.cancel().catch(() => {});
    }
    return { status: res.status, reason };
  };
}

let running = false;
let currentStats: ReturnType<typeof emptyStats> | null = null;
let runStart = 0;

addEventListener('beforeunload', () => {
  if (running && currentStats) {
    log({ ...currentStats, event: 'shutdown', ms: Date.now() - runStart, level: 'warn' });
  }
});

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const supabase = db();
  if (!supabase) {
    log({ fn: 'send-push', event: 'config_error', level: 'error', missing: 'SUPABASE_URL or service key' });
    return json(500, { error: 'server_misconfigured' });
  }

  const secret = req.headers.get('x-cellier-secret');
  if (!secret) return json(401, { error: 'unauthorized' });
  const { data: ok, error: authError } = await supabase.rpc('verify_internal_secret', { p_secret: secret });
  if (authError) {
    log({ fn: 'send-push', event: 'auth_error', level: 'error', code: authError.code ?? null });
    return json(500, { error: 'auth_unavailable' });
  }
  if (ok !== true) return json(401, { error: 'unauthorized' });

  let s: VapidSigner | null;
  try {
    s = await vapidSigner();
  } catch {
    s = null;
  }
  const appUrl = Deno.env.get('CELLIER_APP_URL')?.replace(/\/+$/, '');
  if (!s || !appUrl?.startsWith('https://')) {
    log({ fn: 'send-push', event: 'config_error', level: 'error', missing: 'VAPID_PRIVATE_JWK, VAPID_SUBJECT or CELLIER_APP_URL' });
    return json(500, { error: 'server_misconfigured' });
  }

  if (running) return json(202, { accepted: true, alreadyRunning: true });
  running = true;
  runStart = Date.now();
  const executionId = Deno.env.get('SB_EXECUTION_ID') ?? null;
  currentStats = emptyStats(executionId);

  const work = run(
    {
      store: {
        async claim(limit) {
          const { data, error } = await supabase.rpc('notification_claim', { p_limit: limit });
          if (error) throw new Error(`notification_claim failed: ${error.code ?? 'unknown'}`);
          return (data ?? { items: [] }) as NotificationClaimResult;
        },
        async complete(report: NotificationCompleteReport) {
          const { error } = await supabase.rpc('notification_complete', { p_report: report });
          if (error) throw new Error(`notification_complete failed: ${error.code ?? 'unknown'}`);
        },
      },
      send: webPushSender(s),
      now: Date.now,
      log,
      config: { ...DEFAULT_CONFIG, appUrl, executionId },
    },
    currentStats,
  ).finally(() => {
    running = false;
    currentStats = null;
  });

  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(work);
  else await work; // Local runs without the Supabase runtime.

  return json(202, { accepted: true, alreadyRunning: false });
});
