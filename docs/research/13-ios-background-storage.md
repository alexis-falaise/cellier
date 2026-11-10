# 13. Background execution and storage durability for iOS home-screen web apps

Research date: 2026-11-10. Target: Cellier, an offline-first PWA (Vite, React, TypeScript, service worker, IndexedDB, Supabase), installed to the home screen on iPhone 13 to 15 Pro. Target engines: iOS / Safari 17, 18 and 26.

Verification legend: **VERIFIED** = read on a primary page during this research. **SEARCH** = seen only in search snippets or secondary pages. **UNVERIFIED** = not confirmed; treat as a hypothesis to test on a device.

## 1. Summary

- iOS gives a home-screen web app no background execution API. There is no Background Sync, no Periodic Background Sync and no Background Fetch. Nothing runs after the app is suspended, and the outbox cannot be flushed while the app is closed.
- Work that is queued offline has to be flushed while the app is in the foreground: on app start, on mutation, on `online`, and on `visibilitychange` to hidden as a best-effort last flush.
- Web Locks, BroadcastChannel, SharedWorker and dedicated/module workers exist on iOS 15.4+ and are enough to coordinate one flusher across tabs and workers.
- Push can wake a service worker, but on iOS a push must result in a visible notification. Using push as a silent "flush my outbox" trigger is not a sound design. UNVERIFIED how long the worker stays alive.
- IndexedDB is the right store for the outbox. Persist the outbox with `navigator.storage.persist()`, but treat its grant as heuristic and check `persisted()` at runtime. Do not rely on localStorage for the queue.
- The home-screen app and Safari use separate storage. A user who logs in in Safari is logged out in the installed app, and the reverse holds too. This is a product-level fact to design around.
- Recommended design: a single flush engine in a dedicated module Worker that owns the IndexedDB outbox, guarded by a Web Lock, with idempotency keys on every queued operation, exponential backoff with jitter, and no reliance on Background Sync. Use Background Sync only as a progressive enhancement on Chromium.

## 2. Support table (iOS / Safari 17, 18, 26)

| API / capability | Safari 17 | Safari 18 | Safari 26 | Evidence | Notes for Cellier |
|---|---|---|---|---|---|
| Background Sync (`ServiceWorkerRegistration.sync`, SyncManager) | No | No | No | VERIFIED caniuse SyncManager page: iOS 3.2 to 26.6 not supported, 27.0 to 27.2 not supported ([caniuse](https://caniuse.com/mdn-api_syncmanager_worker_support)). firt.dev table: "Not supported" ([firt.dev](https://firt.dev/notes/pwa-ios/)). WebKit bug 201866 requests it ([WebKit](https://bugs.webkit.org/show_bug.cgi?id=201866)). | The main caniuse Background Sync page lists iOS 13.52 as supported. Treated as an error: every other source says no. |
| Periodic Background Sync | No | No | No | WebKit bug 204117 closed WONTFIX; WebKit: "We oppose this feature and will not implement it" (Dec 2019) ([WebKit bug 204117](https://bugs.webkit.org/show_bug.cgi?id=204117)). firt.dev: not supported. | No position change found. UNVERIFIED whether this changed after 2019. |
| Background Fetch | No | No | No | caniuse: iOS 3.2 to 26.5 not supported ([caniuse](https://caniuse.com/wf-background-fetch)). | Not an option. |
| Web Locks (`navigator.locks`) | Yes (15.4+) | Yes | Yes | VERIFIED: WebKit 15.4 post lists Web Locks as a new mechanism, across same-origin browsing contexts and workers ([WebKit 15.4](https://webkit.org/blog/12445/new-webkit-features-in-safari-15-4/)). caniuse: 15.4 to 26.6 supported. | Use for single-flusher election across tabs and workers. A 2022 bug (locks held in a Worker not released on refresh/exit in 15.4) is reported fixed; UNVERIFIED on 26. |
| BroadcastChannel | Yes (15.4+) | Yes | Yes | caniuse: 15.4 to 26.6 supported ([caniuse](https://caniuse.com/broadcastchannel)). Apple 15.4 notes: enabled between windows, tabs, frames, iframes ([Apple](https://developer.apple.com/tutorials/data/documentation/safari-release-notes/safari-15_4-release-notes.md)). | Use to tell other tabs that the outbox changed. Not a substitute for Web Locks. |
| SharedWorker | Yes (classic) | Yes | Yes | Sources conflict on the cutoff: caniuse says iOS 15 (classic), web-features says iOS 16 ([web-features](https://web-platform-dx.github.io/web-features-explorer/features/shared-workers/)); firt.dev lists 5.0 to 6.1 and 16.0. Module shared workers: caniuse 15 to 26.4 supported (Chrome Android is the gap). | Not needed. Web Locks + BroadcastChannel cover the same need with less risk. Avoid module SharedWorker. |
| Dedicated Worker | Yes | Yes | Yes | UNVERIFIED for exact version; widely supported since iOS 5 class workers. Confirm with caniuse `web-workers`. | Good host for the outbox engine and any SQLite-WASM. |
| Module workers (`new Worker(url, {type:"module"})`) | Likely yes | Likely yes | Likely yes | UNVERIFIED on iOS. Not checked on a primary page. Vite can bundle a worker as classic to avoid the question. | Prefer a Vite-built worker and test the module form on a device before depending on it. |
| OffscreenCanvas | Partial (2D) / see note | Yes | Yes | caniuse newer page: full support from 16.4; older snapshot listed 16.2 to 16.7 as partial and 17.0+ as supported ([caniuse](https://caniuse.com/offscreencanvas)). WebGL context: 17.0+ (caniuse). | Not needed for the sync engine. Listed only for completeness. |
| `navigator.onLine` and `online` / `offline` events | Yes | Yes | Yes | Exists on iOS. Reliability: UNVERIFIED for iOS specifically. Generic behavior: `onLine` reflects having a network interface, not reachability (captive portal, dead backend). | Never trust `online` alone. Confirm with a cheap request to the backend (e.g. HEAD on a health endpoint) before flushing. |
| `visibilitychange` (hidden / visible) | Yes | Yes | Yes | WebKit bug 199854: on iOS, `visibilitychange` fires when switching tabs, but not when the tab is closed or Safari is suspended/killed; `pagehide`, `beforeunload`, `unload` reported as not firing (tested iOS 16.3.1) ([WebKit 199854](https://bugs.webkit.org/show_bug.cgi?id=199854)). W3C Beacon spec says `visibilitychange` is the only event guaranteed on mobile background transitions ([W3C Beacon](https://www.w3.org/TR/beacon)). | Main "last flush" hook. Still not guaranteed to run before suspension. |
| `pagehide` / `unload` | Unreliable | Unreliable | Unreliable | WebKit bug 199854 (above). Apple forum: sync XHR with `unload` broke in iOS 13.4. | Do not put the only flush on `pagehide`. |
| Page Lifecycle (freeze / resume events) | No | No | No | UNVERIFIED: not checked on a primary page; the Page Lifecycle `freeze`/`resume` events are Chromium-only per general knowledge. | Do not design around them. |
| How fast iOS suspends a backgrounded home-screen app | Unknown | Unknown | Unknown | UNVERIFIED. No primary source found. Assume any JS, timer or fetch stops within seconds of leaving the app; measure on device. | Design so that a queued write is safe on disk before the user can leave the screen. |
| Service worker: push wakes the worker | Yes (16.4+) | Yes | Yes | Web Push requires the app on the Home Screen, iOS 16.4+ ([WebKit 13878](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)). The push event is dispatched to the SW "like before" ([WebKit 16535](https://webkit.org/blog/16535/meet-declarative-web-push/)). | How long the worker stays alive and whether the work can do network I/O after a push: UNVERIFIED. Apple's doc says a visible notification must follow each push (SEARCH snippet, the doc page itself was not readable). |
| Declarative Web Push (no SW needed) | No (18.4+ only) | Yes (18.4+) | Yes | WebKit 16535, March 27, 2025: works without an installed service worker; SW can only modify displayed content ([WebKit](https://webkit.org/blog/16535/meet-declarative-web-push/)). | Visible notifications only. Not a data-refresh channel. |
| Badging API | Yes (home screen) | Yes | Yes | firt.dev: 16.4+, installed PWAs only, works in SW push handling ([firt.dev](https://firt.dev/notes/pwa-ios/); [WebKit 13878](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)). | Not for sync state. |
| `fetch` `keepalive` | Yes | Yes | Yes | caniuse Request keepalive: iOS 13 to 26.5 supported ([caniuse](https://caniuse.com/mdn-api_request_keepalive)). | Body is limited (64 KiB total for keepalive per Fetch spec, general knowledge, UNVERIFIED on iOS). Use for small last-moment writes only. |
| `navigator.sendBeacon` | Yes | Yes | Yes | Historical bug 188329 (pagehide sends) fixed in iOS 12.2 per the bug thread; an iOS 14 report still says sendBeacon in pagehide failed ([WebKit 188329](https://bugs.webkit.org/show_bug.cgi?id=188329)). | Fire from `visibilitychange` to hidden, not `pagehide`. POST only; no custom headers. Auth token cannot be sent. Design the endpoint for it or skip it. |
| IndexedDB | Yes; known reliability bugs | Yes; known reliability bugs | Yes; no confirmed fix found | Bugs: 273827, 277615, 282093 (connections closing, "UnknownError: Connection to Indexed Database server lost", reported iOS 17.4 to 18.1; status: unassigned as of May 2025) ([WebKit 277615](https://bugs.webkit.org/show_bug.cgi?id=277615)). iOS 18.4.x BLOB regression also reported ([WebKit 292142](https://bugs.webkit.org/show_bug.cgi?id=292142)). | Biggest storage risk. See section 5. |
| `navigator.storage.persist()` / `persisted()` | Yes (15.2+) | Yes | Yes | firt.dev: Storage Management: Persistent, iOS 15.2+ ([firt.dev](https://firt.dev/notes/pwa-ios/)). WebKit 2023: grant "based on heuristics like whether the website is opened as a Home Screen Web App" ([WebKit storage policy, Aug 10 2023](https://webkit.org/?p=14403)). | Grant is not guaranteed. A SEARCH snippet (developer forum) says it is always denied on iOS; this contradicts WebKit and is treated as wrong. |
| `navigator.storage.estimate()` | Yes | Yes | Yes | WebKit 2023: origin quota up to 60% of disk, overall quota up to 80%, same for browser tab and home-screen app (no separate HS figure) ([WebKit](https://webkit.org/?p=14403)). | Use for diagnostics only. The number is not a guarantee. |
| 7-day cap on script-writable storage (ITP) | Applies to Safari | Applies to Safari | Applies to Safari | VERIFIED: WebKit 10218 (Safari 13.1, March 2020): delete script-writable storage "after seven days of Safari use without user interaction on the site" ([WebKit 10218](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/)). | See section 4. |
| 7-day cap for home-screen apps | Own counter per WebKit 2020 | Own counter per WebKit 2020 | Own counter per WebKit 2020 (UNVERIFIED for 26) | VERIFIED WebKit 10218: "Web applications added to the home screen are not part of Safari and thus have their own counter of days of use." Also: "We do not expect the first-party in such a web application to have its website data deleted." Conflicting report: WebKit bug 237350 (2022) reports home-screen app cookies deleted after 7 days on iOS 15.3 ([WebKit 237350](https://bugs.webkit.org/show_bug.cgi?id=237350)). | Treat the home-screen app as exempt in principle, but do not rely on it without a persist grant plus a re-sync path. |
| Cache Storage (`caches`) limits | Origin quota | Origin quota | Origin quota (UNVERIFIED for cache-specific limits) | Cache API is script-writable; whether the 7-day cap applies to it is UNVERIFIED. | Do not store the outbox in Cache Storage. |
| OPFS (`navigator.storage.getDirectory()`) | Yes (15.2+) | Yes | Yes | firt.dev: origin private file system via FileSystem Access, iOS 15.2+. WebKit 15.2 announcement ([WebKit](https://webkit.org/?p=12257)). Safari 26.0 added File System WritableStream API ([WebKit 17333](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)). | `createSyncAccessHandle` in a worker (needed for fast SQLite-WASM): UNVERIFIED on iOS. |
| SQLite-WASM on OPFS | Unverified | Unverified | Unverified | WebKit bug 252138 (Feb 2023): SQLite WASM OPFS failing in Safari 16.3 preview, later closed fixed; single-reporter account ([WebKit 252138](https://lists.webkit.org/pipermail/webkit-unassigned/2023-February/1087018.html)). | Not recommended for v1. See section 5. |
| Home-screen app storage vs Safari | Separate | Separate | Separate, and sites now open as web apps by default | WebKit bug 181849: home-screen apps do not share storage with Safari (status UNVERIFIED). WebKit 17333: "every website added to the Home Screen opens as a web app by default" in 26.0 (VERIFIED). | Login in Safari does not carry to the installed app. Plan for a fresh sign-in. |
| iOS 27 | UNVERIFIED | UNVERIFIED | Caniuse entries list 27.0 to 27.2 for some APIs (SyncManager not supported) | Search snippets only. | Re-check when a device is on 27. |

## 3. Storage behavior in more detail

### 7-day cap
- What WebKit published (VERIFIED, 2020): script-writable storage (localStorage, IndexedDB, script-set cookies, and similar) is deleted after seven days of **Safari use** without user interaction on that site. Days are counted as days of use, not calendar days.
- Home-screen web apps are, per WebKit's statement, their own counter. Their days of use match real use of the app.
- Contradicting report: WebKit bug 237350 (March 2022) describes logouts after seven days in a home-screen app on iOS 15.3. Whether this was a real ITP path or a cookie-expiry issue is not settled.
- Practical stance: assume data can be lost after a long period of non-use, even for an installed app. The outbox must survive that and the app must re-sync from the server after a sign-in.

### navigator.storage.persist
- WebKit 2023 (VERIFIED): persistence is granted on heuristics, including Home Screen usage. Persistent origins are excluded from the ITP eviction path as far as the post describes. Grant is not guaranteed.
- Call `persist()` after the first real user action (not at boot), then store the result in app state. Show a one-line warning if `persisted()` returns false and the outbox has pending items.

### IndexedDB reliability
- Known open bugs (SEARCH/VERIFIED on the bug pages): connections closing unexpectedly and failing to reopen (273827, 277615, 282093), with reports of data not persisted on iOS 17.4 to 18.x. A regression on BLOB reads in iOS 18.4.x (292142).
- Mitigations: open a fresh connection on each transaction batch, catch `UnknownError` and `InvalidStateError`, retry with backoff, never hold a long-lived connection across suspension, keep records small, and verify writes by reading them back before deleting the source of truth.

### OPFS and SQLite-WASM
- OPFS is present on iOS 15.2+. The performant SQLite path needs `createSyncAccessHandle` in a worker. Its iOS status is UNVERIFIED.
- Historic bugs (252138) suggest it worked eventually, but the signal is thin. For v1, IndexedDB is the simpler and better-characterised choice for an outbox of a few hundred records.

### Separate storage
- Safari and the home-screen app do not share IndexedDB, localStorage, cookies or login. Show a first-run message in the installed app if the user has an existing Safari session, and do not assume a token exists.

## 4. Push, service worker lifetime and what can run

- Web Push on iOS: iOS/iPadOS 16.4+, Home Screen app only, permission request must come from a direct user gesture (VERIFIED, WebKit 13878).
- Declarative Web Push (iOS 18.4+, WebKit 16535, March 27, 2025): notifications can be shown without a service worker. Visible notifications only.
- Visible-notification rule: a SEARCH snippet of Apple's developer documentation says Safari does not support invisible pushes and may revoke permission if a push does not display. The Apple page was not readable during this research; treat as UNVERIFIED until read directly.
- What a push can do on iOS: deliver an event to the service worker. Whether the worker can complete a `fetch` and an IndexedDB write after the push, how long it stays alive, and whether it is throttled: all UNVERIFIED.
- Conclusion: a push is not a reliable outbox flush trigger on iOS. It can be used as a signal that the user should open the app, or as a visible "your data changed" notice. Do not send pushes whose only purpose is to wake the app.

## 5. What runs where

| Piece | Where | Why |
|---|---|---|
| App shell caching, offline navigation | Service worker | Works offline; no background execution needed. |
| Outbox storage (IndexedDB) | Dedicated Worker (writes), readable from page | Survives reloads; the worker keeps UI-thread work out of the flush path. |
| Flush engine (network sends, backoff, idempotency) | Dedicated module Worker | Runs only while the page is alive, which is the same lifetime as any iOS background work. Single owner per origin via Web Lock. |
| Election / mutual exclusion across tabs and worker | Web Locks | Supported 15.4+. |
| Change notifications between tabs | BroadcastChannel | Supported 15.4+. |
| Background Sync flush | Service worker `sync` event, Chromium only | Progressive enhancement; not available on iOS. |
| SQLite-WASM over OPFS | Dedicated Worker | Not in v1; revisit after device tests. |

Do not run the flush engine in a service worker on iOS. A SW is not guaranteed to be alive when the app is closed, and nothing else in iOS will wake it for a sync.

## 6. When the outbox flushes

| Trigger | Action | Reliability on iOS |
|---|---|---|
| Mutation enqueued | Debounced flush (about 300 ms) if online per a recent successful request | High while the app is open |
| App start / worker boot | Flush all pending ops whose `nextAttemptAt` is due | High |
| `online` event | Probe backend first, then flush | Medium: `online` is not a reachability signal |
| `visibilitychange` to hidden | Best-effort flush with `keepalive: true` for small ops; do not await | Low: may not complete |
| `pagehide` | Nothing. Not reliable on iOS | None |
| Push | Do not flush on push. Show a visible notification only if the product needs one | Not a flush path |
| Periodic timer | Only while the app is visible, every few minutes, to retry due ops | Medium |
| Backoff on failure | Exponential: 2 s, 4 s, 8 s, ... capped at 5 min, full jitter; reset on success | Required |

## 7. Code sketches

These are sketches, not drop-in code. They target TypeScript strict mode and assume the Supabase client is wrapped in `sendOp`.

### 7.1 Outbox schema and operations (runs in the dedicated Worker)

```ts
// outbox.ts (runs inside the dedicated module Worker)
export type OutboxStatus = 'pending' | 'inflight' | 'done' | 'dead';

export interface OutboxOp {
  id: string;              // crypto.randomUUID(), also the idempotency key
  table: string;
  kind: 'insert' | 'update' | 'delete';
  payload: unknown;
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;   // epoch ms; 0 = due now
  status: OutboxStatus;
  lastError?: string;
}

const DB = 'cellier-outbox';
const STORE = 'ops';

export function openOutbox(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const s = req.result.createObjectStore(STORE, { keyPath: 'id' });
      s.createIndex('due', ['status', 'nextAttemptAt']);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Open a fresh connection per batch; iOS may close long-lived ones.
export async function withDb<T>(fn: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await openOutbox();
  try { return await fn(db); } finally { db.close(); }
}

export function putOp(db: IDBDatabase, op: OutboxOp): Promise<void> {
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(op);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error ?? new Error('aborted'));
  });
}
```

### 7.2 Flush engine with a single-owner Web Lock and backoff

```ts
// flush.ts (dedicated module Worker)
const LOCK = 'cellier:outbox-flush';
const MAX_BACKOFF_MS = 5 * 60_000;

export function backoffDelay(attempts: number): number {
  const exp = Math.min(MAX_BACKOFF_MS, 2_000 * 2 ** attempts);
  return Math.random() * exp; // full jitter
}

export async function flushOnce(
  sendOp: (op: OutboxOp) => Promise<'ok' | 'retry' | 'drop'>,
): Promise<void> {
  // ifAvailable: if another tab/worker holds the lock, do nothing.
  await navigator.locks.request(LOCK, { ifAvailable: true }, async (lock) => {
    if (!lock) return;
    const db = await openOutbox();
    try {
      const due = await loadDueOps(db, Date.now(), 50);
      for (const op of due) {
        const result = await sendOp(op); // uses op.id as idempotency key
        if (result === 'ok') await deleteOp(db, op.id);
        else if (result === 'drop') await markDead(db, op);
        else await scheduleRetry(db, op, Date.now() + backoffDelay(op.attempts + 1));
      }
    } finally {
      db.close();
    }
  });
}

// loadDueOps, deleteOp, markDead, scheduleRetry: IndexedDB helpers
// omitted for brevity. Each runs in its own transaction.
declare function loadDueOps(db: IDBDatabase, now: number, limit: number): Promise<OutboxOp[]>;
declare function deleteOp(db: IDBDatabase, id: string): Promise<void>;
declare function markDead(db: IDBDatabase, op: OutboxOp): Promise<void>;
declare function scheduleRetry(db: IDBDatabase, op: OutboxOp, at: number): Promise<void>;
```

Important: Web Locks with `ifAvailable` returns immediately. A tab that loses the election does nothing, so the outbox is never double-sent by two tabs. The op id is the server-side idempotency key: the Supabase write must upsert on that key (or go through an RPC that checks it), so a retry after a lost response does not duplicate.

### 7.3 Triggers in the page (main thread)

```ts
// triggers.ts (main thread; forwards to the worker)
type Flush = () => void;

export function bindFlushTriggers(flush: Flush, probe: () => Promise<boolean>): () => void {
  const onVisible = () => {
    if (document.visibilityState === 'visible') flush();
  };
  const onHidden = () => {
    if (document.visibilityState === 'hidden') flush(); // best effort, do not await
  };
  const onOnline = async () => {
    // navigator.onLine is not reachability: probe before flushing.
    if (await probe()) flush();
  };

  document.addEventListener('visibilitychange', onVisible);
  document.addEventListener('visibilitychange', onHidden);
  window.addEventListener('online', onOnline);

  flush(); // app start
  const timer = window.setInterval(() => {
    if (document.visibilityState === 'visible') flush();
  }, 60_000);

  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    document.removeEventListener('visibilitychange', onHidden);
    window.removeEventListener('online', onOnline);
    window.clearInterval(timer);
  };
}
```

### 7.4 Service worker (shell + optional Chromium Background Sync)

```ts
// sw.ts
declare const self: ServiceWorkerGlobalScope;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Shell and navigation caching only. No outbox logic on iOS.

// Progressive enhancement: Chromium only. On iOS the "sync" event never fires.
export async function registerSyncIfSupported(reg: ServiceWorkerRegistration): Promise<void> {
  if ('sync' in reg) {
    await (reg as ServiceWorkerRegistration & { sync: { register(tag: string): Promise<void> } })
      .sync.register('cellier-outbox');
  }
}

self.addEventListener('sync' as never, (e: Event) => {
  const ev = e as ExtendableEvent & { tag: string };
  if (ev.tag !== 'cellier-outbox') return;
  // Post a message to an open client to run the flush engine there.
  // Do not open IndexedDB or do network sends here unless tested on Chromium.
  ev.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) =>
      clients.forEach((c) => c.postMessage({ type: 'flush' })),
    ),
  );
});
```

### 7.5 Persistence request at a sensible moment

```ts
// storage.ts
export async function ensurePersistent(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist(); // heuristic on iOS; may be false
  } catch {
    return false;
  }
}
```

Call after the first user mutation, not at boot, and surface the result as a diagnostic.

## 8. Recommended design

1. Store the outbox in IndexedDB, in a dedicated module Worker. Open a fresh connection per batch.
2. Give every op a UUID `id` and send it as the idempotency key. Make the Supabase side idempotent on it.
3. Run the flush engine in the Worker, guarded by `navigator.locks.request(name, { ifAvailable: true }, ...)`. One owner across all tabs.
4. Flush on: mutation (debounced), app start, `online` (after a probe), `visibilitychange` to hidden (best effort, `keepalive`), and a 60 s visible-only timer for retries.
5. Do not flush on `pagehide` or on push. Do not depend on any iOS background task.
6. Backoff: exponential from 2 s, full jitter, cap 5 min, reset on success, mark dead after N attempts with a visible error.
7. Call `navigator.storage.persist()` after the first user action; log `persisted()`; warn the user if it is false and the outbox is not empty.
8. Keep the service worker for the app shell. Use Background Sync only as an opt-in enhancement on Chromium, which posts a message to a window to run the same engine.
9. Treat the home-screen app and Safari as separate clients: plan a fresh sign-in path and a server-side re-sync on login.
10. Before depending on any of the UNVERIFIED items (push wake duration, module workers, OPFS sync handles, suspension timing), test on a real iPhone 13 to 15 Pro on iOS 17, 18 and 26: background the app for 10 s, 1 min and 10 min with a pending op, and log whether the op flushed.

## 9. Open questions (UNVERIFIED)

- How long iOS keeps a home-screen app's JS alive after `visibilitychange` to hidden, and whether an in-flight `fetch` completes.
- Whether a push wakes the SW long enough to make a network request and write IndexedDB, and whether Apple's visible-notification rule is strictly enforced.
- Whether the 7-day cap applies to Cache Storage and to IndexedDB in a home-screen app with a persist grant, on iOS 26.
- OPFS `createSyncAccessHandle` behavior on iOS 17, 18 and 26.
- Whether the IndexedDB connection-closing bugs (273827, 277615, 282093) are fixed on iOS 26.
- Whether iOS 27 changes any of the rows above (caniuse snippets already list 27.0 to 27.2 for some APIs).

## 10. Sources

- WebKit, Safari 13.1 / ITP, 7-day cap, home-screen counter: https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/ (VERIFIED)
- WebKit, Updates to Storage Policy (Aug 10, 2023): https://webkit.org/?p=14403 (VERIFIED; the post itself is https://webkit.org/blog/14403/updates-to-storage-policy/)
- WebKit, New WebKit Features in Safari 15.4 (Web Locks, BroadcastChannel): https://webkit.org/blog/12445/new-webkit-features-in-safari-15-4/ (VERIFIED)
- WebKit, Web Push for Web Apps on iOS and iPadOS (Feb 16, 2023): https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/ (VERIFIED)
- WebKit, Meet Declarative Web Push (Mar 27, 2025): https://webkit.org/blog/16535/meet-declarative-web-push/ (VERIFIED)
- WebKit Features in Safari 26.0 (Sep 15, 2025): https://webkit.org/blog/17333/webkit-features-in-safari-26-0/ (VERIFIED)
- Apple Safari 15.4 release notes: https://developer.apple.com/tutorials/data/documentation/safari-release-notes/safari-15_4-release-notes.md (VERIFIED via search snippet)
- Apple, Sending web push notifications in web apps and browsers: https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers (page body NOT readable; claims about visible notifications are SEARCH only)
- caniuse, SyncManager: https://caniuse.com/mdn-api_syncmanager_worker_support (SEARCH)
- caniuse, Background Sync: https://caniuse.com/background-sync (SEARCH; iOS 13.52 entry disputed)
- caniuse, Background Fetch: https://caniuse.com/wf-background-fetch (SEARCH)
- caniuse, Web Locks / navigator.locks: https://caniuse.com/mdn-api_navigator_locks (SEARCH)
- caniuse, BroadcastChannel: https://caniuse.com/broadcastchannel (SEARCH)
- caniuse, SharedWorker: https://caniuse.com/sharedworkers (SEARCH; conflicts with web-features)
- caniuse, OffscreenCanvas: https://caniuse.com/offscreencanvas (SEARCH; versions conflict between snapshots)
- caniuse, Request keepalive: https://caniuse.com/mdn-api_request_keepalive (SEARCH)
- firt.dev, iOS PWA Compatibility: https://firt.dev/notes/pwa-ios/ (VERIFIED table; last updated 13 Oct 2026 per page)
- web-platform-dx feature explorer, Shared workers: https://web-platform-dx.github.io/web-features-explorer/features/shared-workers/ (SEARCH)
- WebKit bug 201866, Background Sync for Safari iOS: https://bugs.webkit.org/show_bug.cgi?id=201866 (SEARCH)
- WebKit bug 204117, Periodic Background Sync (WONTFIX, Dec 2019): https://bugs.webkit.org/show_bug.cgi?id=204117 (SEARCH)
- WebKit bug 199854, visibilitychange / pagehide on iOS: https://bugs.webkit.org/show_bug.cgi?id=199854 (SEARCH)
- WebKit bug 188329, sendBeacon / keepalive: https://bugs.webkit.org/show_bug.cgi?id=188329 (SEARCH)
- WebKit bug 237350, home-screen cookies deleted after 7 days (2022): https://bugs.webkit.org/show_bug.cgi?id=237350 (SEARCH)
- WebKit bug 181849, home-screen apps do not share storage with Safari: https://bugs.webkit.org/show_bug.cgi?id=181849 (SEARCH; status UNVERIFIED)
- WebKit bug 277615, IndexedDB connection lost (iOS 17.4 to 18.1): https://bugs.webkit.org/show_bug.cgi?id=277615 (SEARCH)
- WebKit bug 273827, 282093, 292142: https://bugs.webkit.org/show_bug.cgi?id=273827 , https://bugs.webkit.org/show_bug.cgi?id=282093 , https://bugs.webkit.org/show_bug.cgi?id=292142 (SEARCH)
- WebKit bug 252138, SQLite WASM OPFS in Safari: https://lists.webkit.org/pipermail/webkit-unassigned/2023-February/1087018.html (SEARCH)
- WebKit 15.2 OPFS announcement: https://webkit.org/?p=12257 (SEARCH)
- W3C Beacon: https://www.w3.org/TR/beacon (SEARCH)
- Apple Safari 15.4 release notes page: https://developer.apple.com/documentation/safari-release-notes/safari-15_4-release-notes.md (SEARCH)
