# 12 - Sending Web Push from Supabase (Cellier)

Research date: 2026-11-10. Scope: Web Push (VAPID + aes128gcm) from a Supabase Edge Function (Deno), triggered by low-stock inventory changes, plus a daily digest, on the Supabase FREE plan.

Legend: **VERIFIED** = read on a primary source during this research. **UNVERIFIED** = from a third-party source, from memory, or not confirmed; must be checked before relying on it.

---

## 0. Summary of recommendations

| Question | Recommendation |
|---|---|
| Library | `npm:@pushforge/builder@2.0.4` (Web Crypto only, README lists Deno as supported). Fallbacks: `npm:web-push-neo`, `jsr:@negrel/webpush` (not recommended for production, see 2). Avoid `npm:web-push` in Edge Functions until tested. |
| Keys | Generate once with `npx @pushforge/builder vapid` (UNVERIFIED output shape), store the private key as JWK JSON in an Edge Function secret, and publish the public key as base64url `applicationServerKey` to the client. |
| Trigger | Row trigger writes a row into a `notification_outbox` table **in the same transaction** as the stock change (with per-item dedupe via an `is_low` flag). A `pg_cron` job drains the outbox every minute, groups rows per household (debounce window of 20 s), and calls the Edge Function through `pg_net`. |
| Digest | `pg_cron` job every hour at :00 UTC that inserts a digest row only when the Europe/Paris local hour is 18. DST-proof without relying on cron time-zone support. |
| Secrets | Function URL and a shared secret in Supabase Vault; the Edge Function is deployed with `verify_jwt = false` and checks the shared secret header itself. |
| Limits that matter | Free plan: 150 s wall clock per invocation; 500,000 Edge Function invocations included; project **paused after 1 week of inactivity**; 5 GB egress; 500 MB DB. CPU limit wording conflicts across Supabase pages (see 6). pg_net does **not** retry. |

---

## 1. Platform facts (Supabase)

### 1.1 Edge Function limits (Free plan)
- Wall clock: **"Free plan: 150s"**. VERIFIED: https://supabase.com/docs/guides/functions/limits
- CPU time: the limits page says **2 seconds** "Amount of actual time spent on the CPU per request - does not include async I/O". A separate troubleshooting page (last edited 2026-02-06 per a search snippet) mentions **200 milliseconds** of active computing. **UNVERIFIED which applies.** Sources: https://supabase.com/docs/guides/functions/limits and https://supabase.com/docs/guides/troubleshooting/edge-function-cpu-limits
- Memory: "Maximum Memory: 256MB" VERIFIED (limits page).
- Invocations: **500,000 included** on Free (Edge Functions row of pricing). VERIFIED on https://supabase.com/pricing (period not stated on the row; assume monthly, UNVERIFIED).
- Wall clock idle timeout: requests without a response within 150 s get 504 (search snippet of the troubleshooting page, UNVERIFIED in full).

### 1.2 Free plan project pausing
- "Free projects are paused after 1 week of inactivity. Limit of 2 active projects." VERIFIED: https://supabase.com/pricing
- Definition: "A Free plan project is considered inactive if it does not receive sufficient user database activity over the past week." VERIFIED: https://supabase.com/docs/guides/platform/free-project-pausing
- Warning email about a week before pause; confirmation email at pause. VERIFIED (same page).
- Restore window: up to **1 year** after pause. VERIFIED (same page).
- **Whether pg_cron jobs or Edge Function calls made by pg_cron/pg_net count as "activity" is not documented.** UNVERIFIED. Practical consequence: a digest that runs daily is not guaranteed to keep the project alive. Plan for: the project may pause after a quiet week (for example a holiday); the app's own user traffic is the reliable keep-alive. Monitor the warning email.
- Paid plans cannot be paused for inactivity (VERIFIED, same page).

### 1.3 Edge Functions: npm and Node compatibility
- `npm:` specifiers are supported; Supabase recommends a per-function `deno.json` with an `imports` map; `deno.json` takes precedence over import maps. VERIFIED: https://supabase.com/docs/guides/functions/dependencies
- Built-in Node APIs are supported ("Edge Functions now natively supports npm modules and Node built-in APIs", post dated 2023-12-12). VERIFIED: https://supabase.com/blog/edge-functions-node-npm
- The docs do **not** say which Node modules (for example `node:crypto` internals) are fully supported. UNVERIFIED. The Node APIs page URL I tried returned 404 (https://supabase.com/docs/guides/functions/nodejs-apis); try the current compatibility page before relying on Node built-ins.

### 1.4 Secrets and reserved variables
VERIFIED: https://supabase.com/docs/guides/functions/secrets
- Set: `supabase secrets set NAME=value` or `supabase secrets set --env-file .env`; the dashboard also works. Functions read new secrets without redeploy.
- Names cannot start with `SUPABASE_` (reserved).
- Auto-provided: `SUPABASE_URL`, `SUPABASE_DB_URL`, `SUPABASE_PUBLISHABLE_KEYS` (JSON), `SUPABASE_SECRET_KEYS` (JSON, bypasses RLS), `SUPABASE_JWKS`; legacy `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` still listed.
- The page gives no size limit for secret values (UNVERIFIED whether one exists).
- The exact JSON shape of `SUPABASE_SECRET_KEYS` is not shown in the page; the code below uses the legacy `SUPABASE_SERVICE_ROLE_KEY` (UNVERIFIED that it is still injected on new projects; check the dashboard).

### 1.5 JWT verification and calls from the database
VERIFIED: https://supabase.com/docs/guides/functions/auth
- `verify_jwt` defaults to `true`. Disable per function in `supabase/config.toml`:
  ```toml
  [functions.send-push]
  verify_jwt = false
  ```
- The auth page's recommended pattern for non-user callers is `auth: 'secret'` in the `withSupabase` wrapper (a newer SDK helper; UNVERIFIED for this codebase). The code in section 4 does a plain header check instead, which does not depend on that helper.

### 1.6 pg_net
VERIFIED: https://supabase.com/docs/guides/database/extensions/pg_net
- Signature: `net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{"Content-Type": "application/json"}', timeout_milliseconds int default 2000) returns bigint` (request id).
- **Asynchronous**: "HTTP requests are not started until the transaction is committed." Requests are queued in `net.http_request_queue`.
- Responses in `net._http_response` (columns: `id, status_code, content_type, headers, content, timed_out, error_msg, created`). Default TTL 6 hours (changeable by a superuser via `pg_net.ttl`).
- Consequence: pg_net does **not** retry. Failures do not roll back the triggering transaction. The retry logic must be in SQL (section 3.4).
- Secrets: "any role able to log in to the database can read the secret key while the request is queued" because the decrypted key is written to `net.http_request_queue`. VERIFIED (schedule-functions page, cited below). Mitigation: restrict the queue, rotate the shared secret, and use a dedicated low-privilege secret (not the service role key) for the database-to-function call.

### 1.7 Vault
VERIFIED example: https://supabase.com/docs/guides/functions/schedule-functions
```sql
select vault.create_secret('https://project-ref.supabase.co', 'project_url');
select vault.create_secret('YOUR_SECRET', 'secret_key');
-- read:
select decrypted_secret from vault.decrypted_secrets where name = 'project_url';
```

### 1.8 Database Webhooks
VERIFIED: https://supabase.com/docs/guides/database/webhooks
- Wrapper around triggers using pg_net; events fire after row change; does not block the write.
- Documented: HTTP POST/GET with JSON payload. No documented retry policy, no documented delivery guarantee, no payload signing. The secret key is stored in the trigger definition (visible in dumps).
- Not suitable for debounce or dedupe: one HTTP call per row change, no batching.

### 1.9 pg_cron
VERIFIED: https://supabase.com/docs/guides/cron
- Jobs stored in `cron.job`; runs logged in `cron.job_run_details`. Jobs can run "every second to once a year". Recommendation: no more than 8 jobs concurrently.
- **Timezone: not stated on the Supabase page.** The upstream pg_cron docs (Crunchy Data, search result only, UNVERIFIED for Supabase) say the worker uses GMT by default and that `cron.timezone` in postgresql.conf changes it (self-managed Postgres). Assume **UTC** on Supabase and do not depend on time-zone configuration. Use the hourly-and-check pattern in section 5.
- Unscheduling: `select cron.unschedule('job-name');` (standard pg_cron API; UNVERIFIED on the Supabase page, which did not state it).
- pg_cron calls to Edge Functions need `pg_net` (VERIFIED from the pgcron extension page snippet: "Edge Function invocation, which needs the pg_net extension").
- Availability on Free plan: UNVERIFIED (not stated on the pages fetched). Check Database > Extensions in the dashboard after project creation.

---

## 2. Library choice

Three candidate libraries plus one reference. All need Web Crypto (ECDH P-256, AES-GCM, HKDF, ECDSA for VAPID JWT). The problem with Node-style libraries is their use of Node's `crypto` module.

### 2.1 `npm:web-push` (the canonical library)
- Reported failures in Supabase/Deno: a Supabase user saw `Error: Not implemented: crypto.Sign` from a function, and a Deno forum thread reports a similar missing-crypto failure for an npm web push library. These are third-party reports (search results, UNVERIFIED that they concern the current `web-push` release or current Supabase runtime).
- Its README (fetched) documents `generateVAPIDKeys()` returning URL-safe Base64 `publicKey` and `privateKey`, `setVapidDetails(subject, publicKey, privateKey)`, and `sendNotification` options `TTL` (default four weeks), `urgency` (`very-low|low|normal|high`), `topic` (max 32 chars), `contentEncoding` (`aes128gcm` default per one section; the other section says `aesgcm`, so the README is inconsistent). Error object exposes `statusCode`, `headers`, `body`. Sources: https://github.com/web-push-libs/web-push
- Subject must be a real `mailto:` or `https:` address; a placeholder can cause Apple to return `403 BadJwtToken` (README, VERIFIED).
- Latest version: **UNVERIFIED** (npm page returned 404 to WebFetch). Last known from my own knowledge: 3.6.x; verify.
- **Verdict: do not use in the Edge Function until a smoke test passes.** If it works on the current runtime, it is the most-documented option.

### 2.2 `npm:@pushforge/builder` (recommended)
- Version seen: **2.0.4** (jsDelivr README URL in search results). Source: https://cdn.jsdelivr.net/npm/@pushforge/builder@2.0.4/README.md ; repo: https://github.com/draphy/pushforge
- README (VERIFIED): runtimes "Node.js, Browsers, Deno, Bun, and Cloudflare Workers"; requires "Node.js 20+ or any runtime with Web Crypto API"; Deno listed as "Fully supported" in the search summary (UNVERIFIED wording).
- API (VERIFIED from README): `buildPushHTTPRequest({ privateJWK, subscription, message: { payload, adminContact, ... } })` returns `{ endpoint, headers, body }`; you then `fetch(endpoint, { method: "POST", headers, body })`. The README Quick Start adds an optional `options` object with `ttl`, `urgency`, `topic`. **The exact nesting of `options` (inside `message` or top-level) is UNVERIFIED**; the code in section 4 places it inside `message`, so check against the README before deploying.
- Keys: generated with `npx @pushforge/builder vapid`. The README passes the private key as `privateJWK`, so the VAPID private key is a **JWK object** (EC P-256, `d` parameter). **The output shape of the CLI is UNVERIFIED** (I did not see the output sample).
- Payload: the README passes `payload: { title, body }` as an object. Whether the library serialises it or expects a string is UNVERIFIED; the code passes a JSON string, which is what a service worker `JSON.parse`s. Test once.
- Error handling for 404/410 is not on the README (we handle the response status ourselves, which is fine).
- Does not mention aes128gcm explicitly on the README (UNVERIFIED that it is the encoding; RFC 8291 requires aes128gcm for Web Push and any compliant library must use it, so treat as expected behaviour, then test).

### 2.3 `jsr:@negrel/webpush`
- Version: **0.5.0** (JSR snapshot; the page says "Published a year ago", exact date UNVERIFIED). Source: https://jsr.io/@negrel/webpush
- Runtimes: "Cloudflare Workers, Deno, Bun, Browsers". Based on Web APIs; implements RFC 8291 and RFC 8292; encryption via the author's `http-ece` (RFC 8188; the README of that library says aes128gcm only). Sources: https://github.com/negrel/http_ece
- Functions per JSR page: `generateVapidKeys`, `importVapidKeys`, `exportVapidKeys`, `exportApplicationServerKey`, type `ExportedVapidKeys`. Send API not confirmed on the JSR page (the `sendNotification` name is not confirmed).
- **Caveat (VERIFIED, README):** "This library hasn't been reviewed by crypto experts and may be unsecure."
- Repo last push: May 2024 per a search snippet (UNVERIFIED).
- **Verdict: acceptable as a fallback for a personal app, but the author warns about security; the pushforge package is the safer default.**

### 2.4 `@block65/webcrypto-web-push`
- Could not verify: the JSR page returned 403 Forbidden and an npm/jsr alternative URL returned 404. **UNVERIFIED** on every point (versions, API, key format). Do not choose it without reading its README.

### 2.5 Other options seen
- `npm:web-push-neo` (fork rewritten in TypeScript, Web Crypto + fetch, runtime agnostic). Source: https://github.com/ryoppippi/web-push-neo (version 0.1.2 per jsDelivr URL; UNVERIFIED maturity). Reasonable second fallback; API is web-push-like (UNVERIFIED).
- `npm:web-push-browser` (zero-dependency, Deno and edge runtimes). Version 1.4.2 per jsDelivr URL (UNVERIFIED API).

---

## 3. VAPID keys

### 3.1 Generation
Option A (pushforge, recommended):
```bash
npx @pushforge/builder vapid
```
Output shape UNVERIFIED. Expect a public key (use it as `applicationServerKey` on the client) and a private JWK. Keep the private key out of git.

Option B (web-push, if it works): `npx web-push generate-vapid-keys --json` gives base64url `publicKey` and `privateKey` (VERIFIED from the web-push README).

### 3.2 Storage
```bash
supabase secrets set \
  VAPID_PRIVATE_JWK='{"kty":"EC","crv":"P-256","x":"...","y":"...","d":"...", ...}' \
  VAPID_SUBJECT='mailto:you@example.com' \
  PUSH_INTERNAL_SECRET="$(openssl rand -hex 32)"
```
Use a real mailto address for `VAPID_SUBJECT` (VERIFIED: web-push README warns about `403 BadJwtToken` with placeholders).

### 3.3 Client public key
`applicationServerKey` must be the **uncompressed P-256 public point**, base64url-encoded (65 bytes: `0x04 || x || y`). If your generator outputs a JWK with `x` and `y` (base64url), derive it in the browser:

```ts
// frontend, TypeScript
function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
function bytesToB64url(b: Uint8Array): string {
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function vapidPublicKeyFromJwk(jwk: { x: string; y: string }): string {
  const x = b64urlToBytes(jwk.x), y = b64urlToBytes(jwk.y);
  const out = new Uint8Array(65);
  out[0] = 0x04; out.set(x, 1); out.set(y, 33);
  return bytesToB64url(out);
}
```
UNVERIFIED that the generator's JWK has `x`/`y` (standard for EC keys, so likely). If the generator already gives a public key string, use that instead.

Subscribe on the client (iOS: the PWA must be installed to the home screen; Web Push on iOS requires iOS 16.4+, UNVERIFIED for the exact version floor, check Apple docs):
```ts
const reg = await navigator.serviceWorker.ready;
const sub = await reg.pushManager.subscribe({
  userVisibleOnly: true,
  applicationServerKey: b64urlToBytes(VAPID_PUBLIC_KEY),
});
// POST sub.toJSON() to your backend, saved to push_subscriptions
```

---

## 4. Edge Function (Deno/TypeScript)

Path: `supabase/functions/send-push/index.ts`. Deployed with `verify_jwt = false` (section 1.5). Imports use `npm:` specifiers pinned to exact versions. Versions: `@supabase/supabase-js@2` (major pin; pin exact for production, UNVERIFIED current minor), `@pushforge/builder@2.0.4`.

Request contract: `POST` with header `x-push-secret: <PUSH_INTERNAL_SECRET>` and JSON body `{ household_id, title, body, url, tag }`. Response: `{ total, sent, gone, failed }`.

```ts
// supabase/functions/send-push/index.ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildPushHTTPRequest } from "npm:@pushforge/builder@2.0.4"; // exact version; verify API against README

const PUSH_INTERNAL_SECRET = Deno.env.get("PUSH_INTERNAL_SECRET") ?? "";
const VAPID_PRIVATE_JWK = JSON.parse(Deno.env.get("VAPID_PRIVATE_JWK") ?? "null");
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
// Legacy key name; check the dashboard shows it on your project (section 1.4).
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type PushBody = {
  household_id: string;
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

type Outcome =
  | { id: string; outcome: "sent" }
  | { id: string; outcome: "gone"; status: number }
  | { id: string; outcome: "failed"; status: number };

const CONCURRENCY = 20;          // stays well inside the 150 s wall clock for hundreds of subs
const TTL_SECONDS = 60 * 60;     // a stock alert older than 1 h is not useful
const PAYLOAD_MAX_BYTES = 3500;  // Web Push payload limit is 4096; keep margin

// Simple bounded-concurrency map. Promise.all over all subs would be fine for
// small households, but this keeps the number of open sockets bounded.
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Constant-time-ish comparison for the shared secret.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const provided = req.headers.get("x-push-secret") ?? "";
  if (!PUSH_INTERNAL_SECRET || !safeEqual(provided, PUSH_INTERNAL_SECRET)) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: PushBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  if (!body.household_id || !body.title) {
    return json({ error: "household_id and title are required" }, 400);
  }

  const { data: subs, error } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("household_id", body.household_id);

  if (error) return json({ error: error.message }, 500);
  if (!subs || subs.length === 0) return json({ total: 0, sent: 0, gone: 0, failed: 0 });

  // Payload is what the service worker receives; keep it small and JSON.
  let payloadStr = JSON.stringify({
    title: body.title,
    body: body.body ?? "",
    url: body.url ?? "/",
    tag: body.tag ?? "cellier",
  });
  if (new TextEncoder().encode(payloadStr).byteLength > PAYLOAD_MAX_BYTES) {
    payloadStr = JSON.stringify({ title: body.title, body: "", url: body.url ?? "/", tag: body.tag ?? "cellier" });
  }

  const outcomes: Outcome[] = await mapLimit(subs, CONCURRENCY, async (s): Promise<Outcome> => {
    try {
      const { endpoint, headers, body: encrypted } = await buildPushHTTPRequest({
        privateJWK: VAPID_PRIVATE_JWK,
        subscription: {
          endpoint: s.endpoint,
          keys: { p256dh: s.p256dh, auth: s.auth },
        },
        message: {
          payload: payloadStr,       // README passes an object; check whether a string is accepted
          adminContact: VAPID_SUBJECT,
          options: {                 // UNVERIFIED nesting; see section 2.2
            ttl: TTL_SECONDS,
            urgency: "normal",
            topic: (body.tag ?? "cellier").slice(0, 32),
          },
        },
      });

      const res = await fetch(endpoint, { method: "POST", headers, body: encrypted });
      await res.body?.cancel();

      if (res.status === 404 || res.status === 410) {
        return { id: s.id, outcome: "gone", status: res.status };
      }
      if (res.ok) return { id: s.id, outcome: "sent" };
      return { id: s.id, outcome: "failed", status: res.status };
    } catch (_e) {
      return { id: s.id, outcome: "failed", status: 0 };
    }
  });

  const goneIds = outcomes.filter((o) => o.outcome === "gone").map((o) => o.id);
  if (goneIds.length > 0) {
    const { error: delErr } = await admin.from("push_subscriptions").delete().in("id", goneIds);
    if (delErr) console.error("failed to delete gone subscriptions", delErr.message);
  }

  return json({
    total: subs.length,
    sent: outcomes.filter((o) => o.outcome === "sent").length,
    gone: goneIds.length,
    failed: outcomes.filter((o) => o.outcome === "failed").length,
  });
});
```

Notes on the function:
- 404 and 410 both delete the subscription, per common practice (blog-level guidance; the IETF WebPush thread suggests 404 and 410 both mean "gone" in practice, UNVERIFIED against final RFC 8030 wording). Treat both as permanent.
- Some browsers keep returning 2xx for stale endpoints; add an inactivity cleanup later (for example delete rows with `created_at < now() - interval '90 days'` that have never been refreshed) if needed.
- The function does not retry failed sends (5xx, 429). The outbox retry in section 3.4 handles whole-request failures (see below).
- Payload size: the Web Push payload limit is 4096 bytes (RFC 8030 section 5.2, UNVERIFIED in this session). The code caps at 3500 bytes.

Local test (CLI): `supabase functions serve send-push --env-file ./supabase/.env.local`, then:
```bash
curl -i -X POST http://127.0.0.1:54321/functions/v1/send-push \
  -H "x-push-secret: $PUSH_INTERNAL_SECRET" -H "Content-Type: application/json" \
  -d '{"household_id":"00000000-0000-0000-0000-000000000000","title":"Test","body":"Hello","url":"/","tag":"test"}'
```

---

## 5. Triggering: options compared

| Option | Transaction safety | Retries | Debounce / batching | Dedupe per item | Free-plan cost | Verdict |
|---|---|---|---|---|---|---|
| Database Webhook (VERIFIED: pg_net wrapper, after row change) | Fires after commit; a failed call does not block the write | None documented (UNVERIFIED) | None: one call per row change | None | 1 invocation per change | Simple, but bursts of withdrawals = many notifications. Not recommended. |
| Trigger calls `net.http_post` directly | Request queued and only sent after commit (VERIFIED); no rollback of user write on failure | None (VERIFIED: pg_net does not retry) | None unless coded | Possible with a flag column | 1 call per change | Good for single events; poor for bursts. |
| Outbox table in the same transaction, drained by pg_cron + pg_net | **Best**: the outbox row commits with the stock change, so no notification is lost and none is sent for a rolled-back change | Done in SQL (requeue failed requests, max attempts) | Yes: group by household and a debounce window | Yes: `is_low` flag reset only on restock | 1 invocation per household per minute at most | **Recommended.** |

Why the outbox is safer than the direct call: `net.http_post` in a trigger is queued and sent after commit, so a rolled-back withdrawal does not send a push (good), but the trigger has no retry and no batching. The outbox keeps the notification intent durable in Postgres.

Latency: the drain runs every minute, so a notification can take up to ~60 s plus the debounce window (20 s). Acceptable for stock alerts. For sub-second delivery, the outbox could call the function directly from the trigger; the trade-off is more calls during bursts.

---

## 6. Free-plan limits that matter

- Wall clock 150 s per invocation (VERIFIED). The fan-out in section 4 is parallel with `CONCURRENCY = 20`, so a household with a few hundred subscriptions still fits (UNVERIFIED timing; measure).
- CPU: 2 s per request per the limits page (VERIFIED), versus 200 ms of active computing per a newer troubleshooting page (UNVERIFIED which applies). ECDH + AES-GCM + an ECDSA-signed VAPID JWT per push is small, but measure per-subscription CPU before scaling. Async I/O (the `fetch` to the push service) is excluded from the 2 s figure per the limits page.
- Invocations: 500,000 included (VERIFIED). A per-minute drain (max one call per household with pending rows) plus an hourly digest check is well below this for a household app.
- Memory: 256 MB (VERIFIED).
- pg_net: asynchronous, no retry, response table kept for 6 h by default (VERIFIED). Retry window for the outbox must be shorter than this.
- pg_cron: up to 8 concurrent jobs recommended (VERIFIED). Timezone not documented for Supabase (UNVERIFIED); design around UTC.
- Pausing: after 1 week of inactivity (VERIFIED); whether pg_cron-driven calls count is UNVERIFIED. Each daily digest is not a guaranteed keep-alive.
- Egress 5 GB and DB 500 MB (VERIFIED, pricing page). Push payloads are small; not a concern unless subscriptions grow large.

---

## 7. Database: tables, trigger, drain, digest, cron (SQL)

Assumed existing table `public.inventory_items(id uuid, household_id uuid, name text, quantity int, threshold int)`. Adjust names to the real schema. All SQL is UNTESTED against the live project; run it on a Supabase branch first.

### 7.1 Tables

```sql
-- Subscriptions: one row per browser/device subscription.
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index if not exists push_subscriptions_household_idx on public.push_subscriptions (household_id);

alter table public.push_subscriptions enable row level security;

-- Users manage their own subscriptions. The Edge Function uses the service role (bypasses RLS).
-- Note: this policy does not check household membership; add that check if your schema has a membership table.
create policy "users manage own push subscriptions"
  on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Per-item dedupe flag: true while the item is at or below threshold.
alter table public.inventory_items
  add column if not exists is_low boolean not null default false;

-- Outbox: notification intent, written in the same transaction as the stock change.
create table if not exists public.notification_outbox (
  id            bigint generated always as identity primary key,
  household_id  uuid not null,
  item_id       uuid,
  kind          text not null default 'low_stock',   -- 'low_stock' | 'digest'
  title         text not null,
  body          text not null,
  url           text not null default '/',
  tag           text,
  created_at    timestamptz not null default now(),
  dispatched_at timestamptz,
  request_id    bigint,
  attempts      int not null default 0
);
create index if not exists notification_outbox_pending_idx
  on public.notification_outbox (created_at) where dispatched_at is null;

-- No RLS policies: only table owner / service role / security definer functions touch it.
alter table public.notification_outbox enable row level security;
```

### 7.2 Trigger (per-item dedupe)

```sql
create or replace function public.inventory_low_stock_outbox()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.quantity <= new.threshold and not new.is_low then
    -- Transition into "low": notify once; stays silent until restocked.
    new.is_low := true;
    insert into public.notification_outbox (household_id, item_id, kind, title, body, url, tag)
    values (
      new.household_id,
      new.id,
      'low_stock',
      'Stock bas',
      new.name || ' : ' || new.quantity || ' restant(s)',
      '/inventory',
      'low-' || new.id::text
    );
  elsif new.quantity > new.threshold and new.is_low then
    -- Restocked: re-arm so the next drop notifies again.
    new.is_low := false;
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_low_stock_outbox on public.inventory_items;
create trigger inventory_low_stock_outbox
  before insert or update of quantity, threshold on public.inventory_items
  for each row execute function public.inventory_low_stock_outbox();
```

Notes:
- `before` trigger so `new.is_low` is saved in the same row write. The insert into the outbox is part of the same transaction: a rolled-back withdrawal leaves no outbox row.
- Only fires when `quantity` or `threshold` change (`update of`).
- Multiple withdrawals in one minute on the same item: the first one flips `is_low`, subsequent ones are silent. Good.

### 7.3 Drain with debounce (one push per household per run) and retry

```sql
-- Stores the Edge Function URL and shared secret in Vault (run once, outside migrations, values not in git).
-- select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/send-push', 'push_fn_url');
-- select vault.create_secret('<same value as PUSH_INTERNAL_SECRET>', 'push_fn_secret');

create or replace function public.drain_notification_outbox()
returns int
language plpgsql
security definer
set search_path = public, net, vault
as $$
declare
  fn_url    text := (select decrypted_secret from vault.decrypted_secrets where name = 'push_fn_url');
  fn_secret text := (select decrypted_secret from vault.decrypted_secrets where name = 'push_fn_secret');
  h         record;
  rid       bigint;
  sent_count int := 0;
  pub_title text;
  pub_body  text;
  pub_tag   text;
begin
  for h in
    select o.household_id,
           array_agg(o.id order by o.id)              as ids,
           count(*)                                    as cnt,
           string_agg(o.body, E'\n' order by o.created_at) as bodies,
           min(o.url)                                  as url,
           min(o.tag)                                  as one_tag
    from public.notification_outbox o
    where o.dispatched_at is null
      and o.attempts < 5
      and o.created_at < now() - interval '20 seconds'   -- debounce window
    group by o.household_id
  loop
    if h.cnt = 1 then
      pub_title := 'Stock bas';
      pub_tag   := h.one_tag;
    else
      pub_title := h.cnt || ' produits à racheter';
      pub_tag   := 'low-stock-' || h.household_id::text;  -- one slot per household for batches
    end if;
    pub_body := left(h.bodies, 300);

    rid := net.http_post(
      url     := fn_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', fn_secret),
      body    := jsonb_build_object(
                   'household_id', h.household_id,
                   'title', pub_title,
                   'body', pub_body,
                   'url', h.url,
                   'tag', pub_tag),
      timeout_milliseconds := 10000
    );

    update public.notification_outbox
       set dispatched_at = now(), request_id = rid, attempts = attempts + 1
     where id = any (h.ids);

    sent_count := sent_count + 1;
  end loop;

  return sent_count;
end;
$$;

-- Requeue rows whose pg_net request failed or timed out (pg_net never retries).
create or replace function public.requeue_failed_pushes()
returns int
language plpgsql
security definer
set search_path = public, net
as $$
declare n int;
begin
  update public.notification_outbox o
     set dispatched_at = null
    from net._http_response r
   where r.id = o.request_id
     and o.dispatched_at is not null
     and o.attempts < 5
     and (r.timed_out or r.status_code is null or r.status_code >= 300);
  get diagnostics n = row_count;
  return n;
end;
$$;
```

Caveats:
- `net._http_response` is kept 6 h by default (VERIFIED); requeue runs every minute, so a failed request is seen well inside that window.
- A `status_code` of 404 or 410 from our own function means our function is misconfigured, not a gone subscription. Such rows would be retried up to 5 times then stop (intended).
- `security definer` with `search_path` pinned. The function URL and shared secret are read inside the database; see section 1.6 for who can read `net.http_request_queue`.
- Retrying a whole household batch can re-send to subscriptions that already got it. Acceptable for stock alerts with a shared `tag` (the OS replaces the earlier notification with the same tag).

### 7.4 Daily digest at 18:00 Europe/Paris (DST-proof)

```sql
-- Inserts one digest row per household with low items, but only when the Paris local hour is 18.
create or replace function public.send_buy_soon_digest()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  if extract(hour from (now() at time zone 'Europe/Paris')) <> 18 then
    return 0;   -- not 18:xx in Paris; the hourly job will try again next hour
  end if;

  insert into public.notification_outbox (household_id, kind, title, body, url, tag)
  select i.household_id,
         'digest',
         'À acheter bientôt',
         string_agg(i.name || ' (' || i.quantity || ')', ', ' order by i.name),
         '/inventory',
         'digest-' || i.household_id::text
    from public.inventory_items i
   where i.quantity <= i.threshold
   group by i.household_id;

  get diagnostics n = row_count;
  return n;
end;
$$;
```

Why this shape: `pg_cron` runs in UTC by default (UNVERIFIED for Supabase, see 1.9). A fixed UTC expression (`0 17 * * *`) is 18:00 Paris only in winter (CET, UTC+1) and 19:00 in summer (CEST, UTC+2). An hourly job at :00 that checks the Paris local hour is correct year round and does not depend on the cron time-zone setting. It fires exactly once per day (the local hour 18 happens once per day).

### 7.5 Cron jobs

```sql
-- Drain the outbox every minute: first requeue failures, then send pending batches.
select cron.schedule(
  'drain-notification-outbox',
  '* * * * *',
  $$ select public.requeue_failed_pushes(); select public.drain_notification_outbox(); $$
);

-- Digest check every hour at :00 (UTC). The function returns early unless Paris local hour is 18.
select cron.schedule(
  'buy-soon-digest',
  '0 * * * *',
  $$ select public.send_buy_soon_digest(); $$
);
```

Digest rows are then sent by the minute drain (with the 20 s debounce). Inspect runs:
```sql
select jobid, jobname, status, return_message, start_time
  from cron.job_run_details order by start_time desc limit 20;
```
Unschedule: `select cron.unschedule('buy-soon-digest');` (standard pg_cron API, UNVERIFIED on Supabase's page).

---

## 8. Securing the function

1. `verify_jwt = false` (section 1.5) because the caller is the database, not a user.
2. The function rejects any request without the shared secret header (section 4). Use a random 32-byte value (`openssl rand -hex 32`); store it once in Supabase secrets (`PUSH_INTERNAL_SECRET`) and once in Vault (`push_fn_secret`). Rotate by updating both.
3. The shared secret is readable by any role that can log in to the database while requests are queued (VERIFIED, section 1.6). Mitigations: do not grant broad DB login roles; prefer a dedicated secret that only authorises this function; rotate periodically.
4. Do not expose `VAPID_PRIVATE_JWK` to clients. It is only in Edge Function secrets.
5. Subscriptions are only read by the service role. The client policy in 7.1 lets a user manage only their own rows; the household check is not in that policy (add it if you add a membership table).
6. The function never logs subscription endpoints or payloads in full.

---

## 9. Source URLs

Supabase (primary):
- https://supabase.com/docs/guides/functions/limits (VERIFIED)
- https://supabase.com/docs/guides/troubleshooting/edge-function-cpu-limits (CPU wording conflict; UNVERIFIED which applies)
- https://supabase.com/pricing (VERIFIED: 500k invocations, 1-week pause, egress and DB)
- https://supabase.com/docs/guides/platform/free-project-pausing (VERIFIED)
- https://supabase.com/docs/guides/functions/dependencies (VERIFIED)
- https://supabase.com/blog/edge-functions-node-npm (VERIFIED, dated 2023-12-12)
- https://supabase.com/docs/guides/functions/secrets (VERIFIED)
- https://supabase.com/docs/guides/functions/auth (VERIFIED)
- https://supabase.com/docs/guides/database/extensions/pg_net (VERIFIED)
- https://supabase.com/docs/guides/functions/schedule-functions (VERIFIED: Vault + pg_net + cron example)
- https://supabase.com/docs/guides/database/webhooks (VERIFIED)
- https://supabase.com/docs/guides/cron (VERIFIED, timezone not stated)
- https://supabase.com/docs/guides/database/extensions/pgcron (stub page on fetch; UNVERIFIED details)

Libraries:
- https://github.com/web-push-libs/web-push (VERIFIED README content; version UNVERIFIED)
- https://cdn.jsdelivr.net/npm/@pushforge/builder@2.0.4/README.md (VERIFIED content; exact options nesting UNVERIFIED)
- https://github.com/draphy/pushforge
- https://jsr.io/@negrel/webpush (VERIFIED: 0.5.0, caveat)
- https://github.com/negrel/webpush (VERIFIED caveat, deno run key command)
- https://github.com/negrel/http_ece (aes128gcm only, per search summary)
- https://github.com/ryoppippi/web-push-neo
- https://jsr.io/@block65/webcrypto-web-push (403, UNVERIFIED)

Spec and error semantics:
- RFC 8030 (Web Push protocol), RFC 8291 (message encryption), RFC 8292 (VAPID): referenced, not fetched in this session (UNVERIFIED wording).
- https://lists.w3.org/Archives/Public/ietf-http-wg/ and https://mailarchive.ietf.org/arch/msg/webpush/ (404/410 discussion, search only)
- https://pushpad.xyz/blog/web-push-errors-explained-with-http-status-codes/ (third-party, UNVERIFIED)

Third-party reports (UNVERIFIED):
- Supabase user report of `crypto.Sign` not implemented from a function triggered by a DB trigger (search summary, https://git.tdem.in/supabase/supabase/issues/26126 mirror).
- https://questions.deno.com/m/1194083672094167161 (Deno forum, web push via Node crypto)
- https://github.com/denoland/deno/issues/22879

---

## 10. Open items to verify before implementation

1. Run a smoke test: `npm:web-push` in an Edge Function on the current runtime (decides whether to use it).
2. Confirm `@pushforge/builder` API: options nesting, string vs object payload, CLI key output shape.
3. Confirm the CPU limit (2 s vs 200 ms) on the live limits page.
4. Confirm `SUPABASE_SERVICE_ROLE_KEY` vs `SUPABASE_SECRET_KEYS` format on the project.
5. Confirm pg_cron and pg_net are enabled on the Free plan (Dashboard > Database > Extensions).
6. Confirm whether pg_cron/pg_net-driven function calls count as "activity" for the 1-week pause (contact Supabase support or observe).
7. Confirm the cron timezone behaviour on Supabase (the design above avoids depending on it).
8. Confirm iOS Web Push minimum version and home-screen requirement against Apple's documentation.
9. Confirm RFC 8030 status-code semantics for 404 vs 410 against the final RFC text.
10. Run all SQL on a Supabase branch (not production) first.
