# 04 — Notifications and forecasting

Status: binding architecture for implementation. Date: 2026-11-10.
Contract: `docs/architecture/contracts/notifications.ts` (types for the push payload, the service-worker
notification data, the two service-role RPCs and the forecasting module). Section numbers in that file (§n) refer
to this document. Shared entity types come from `contracts/domain.ts`.

This document explains, for a reader who has not seen the research notes, how Cellier tells a household that
something is running low, and how it predicts when products will run out and when the next shopping trip will be.
It covers four pieces that work together:

1. the **push subscription** that each installed iPhone registers with the server (§1);
2. the **service worker**, which displays each push message and opens the right screen when it is tapped (§2);
3. the **server pipeline** that turns a stock change into a delivered notification (§3), and the daily digest (§4);
4. the **forecasting module**, which runs on the phone and computes everything the interface shows about running
   low, run-out dates and the shopping list (§5).

Testing is in §6. §7 records which unverified research claims were checked against primary sources and which were
designed around.

---

## 0. Terms

- **Installed app.** Cellier added to the iOS Home Screen and launched from its icon. iOS only allows Web Push for
  installed web apps (iOS 16.4 and later). A page open in a Safari tab cannot receive push.
- **Push subscription.** The object `PushSubscription` that the browser returns from `pushManager.subscribe()`. It
  holds an **endpoint** (an https URL on Apple's push service, unique per installed app and per subscription) and
  two keys, **p256dh** (the device's public key) and **auth** (a shared secret), which the server needs to encrypt
  messages for that device.
- **VAPID.** The scheme (RFC 8292) by which the server proves to the push service that it owns the subscription. It
  uses one P-256 key pair for the whole application: the public key is built into the client, the private key is an
  Edge Function secret.
- **Push message.** One encrypted HTTP POST from the Edge Function to an endpoint. On iOS every push message must
  display a notification (§2).
- **Declarative Web Push.** A payload format shipped by WebKit in iOS 18.4: a JSON object with `"web_push": 8030`
  and a `notification` member. iOS displays it without running any JavaScript. Older iOS versions deliver the same
  bytes to the service worker's `push` handler, which displays it itself. This is called the **classic path**.
- **Household total** of a product. The sum of `stock.quantity` over the pantries of the household whose
  `deleted_at` is null. Running low, forecasts and the shopping list are always computed on the household total,
  never per pantry.
- **Effective minimum** `m` and **clear level** `c` of a product. The quantities at which the product enters and
  leaves the running-low state (§3.1, §5.6).
- **Running low.** A product whose household total is at or under its effective minimum (threshold rule, computed
  identically by the server and the client) or whose forecast says it will be empty within four days (forecast
  rule, client only).
- **Outbox (notification outbox).** The table `private.notification_outbox`, one row per notification intent.
- **Recipient.** A household member who should receive a given notification, together with their push
  subscriptions.
- **Restock session.** A group of `restock` movements whose consecutive times are at most six hours apart. It stands
  for one shopping trip.
- **Courses.** The shopping list screen (route `/groceries`).
- **Paris time.** All calendar reasoning (digest hour, "tomorrow", next trip date) uses the time zone
  `Europe/Paris`.

---

## 1. Push subscription lifecycle on iOS

### 1.1 Overview

Each installed device of each signed-in user holds at most one push subscription. The client stores it in
`public.push_subscriptions` (columns `id`, `user_id`, `endpoint` unique, `p256dh`, `auth`, `user_agent`,
`created_at`, `last_seen_at`, `last_success_at`, `failure_count`). Row-level security lets a user insert, read,
update and delete only rows whose `user_id` equals their own `auth.uid()`. The table holds no household id:
recipients are found through `household_members` at send time, so a subscription follows the user and not a
household.

The device also keeps a local record in IndexedDB (`meta` store, key `push`, type `LocalPushRecord`): the user id,
the endpoint last saved to the server, and the VAPID public key that created the subscription. The local record is
how the client notices that the subscription changed.

The client code lives in `src/push/` (`installState.ts`, `enable.ts`, `reconcile.ts`, `signOut.ts`).

### 1.2 Installed-state detection and availability

`isStandalone()` is true when `matchMedia('(display-mode: standalone)').matches` or `navigator.standalone === true`
(the older iOS flag). `isIOS()` matches `iPhone|iPad|iPod` in the user agent, or `MacIntel` with touch points
(iPadOS). `pushSupported()` is true when `serviceWorker` is in `navigator` and both `PushManager` and
`Notification` exist on `window`.

The Notifications settings page and the Accueil card read one derived value, `PushAvailability`:

| Value | Condition | What the interface offers |
|---|---|---|
| `not-installed` | `isIOS() && !isStandalone()` | The install guide (Share, then «Sur l’écran d’accueil»). No permission request is ever made from a Safari tab. |
| `unsupported` | `!pushSupported()` (iOS older than 16.4, or another browser without push) | A line saying that notifications need iOS 16.4 or later. |
| `default` | Installed, `Notification.permission === 'default'` | The «Activer les notifications» button (§1.3). |
| `denied` | `Notification.permission === 'denied'` | Text: «Notifications refusées. Pour les autoriser : Réglages › Notifications › Cellier.» The app never asks again; iOS would not show the prompt. |
| `granted-subscribed` | Permission granted and a subscription exists | The two preference switches (§1.10). |
| `granted-not-subscribed` | Permission granted but `getSubscription()` returns null and silent re-subscription failed (§1.5) | A row «Notifications interrompues» with a «Réactiver» button that runs the enable flow from the tap. |

Because iOS 26 can open a Home Screen site as a browser tab, `isStandalone()` can be false for a user who did
install the app. The code therefore never treats `not-installed` as proof: if `pushSupported()` is true and the
user taps the button anyway (for example from the Notifications page), the enable flow runs and its failure is
reported as `not-installed` only when `subscribe()` actually throws.

### 1.3 When and how permission is asked

Permission is requested only from a tap, only inside the installed app, and never during the first session.

- **Never on first launch.** The first session (from install until the app is closed) shows no notification prompt
  and no card. The card is also never shown before the household has at least one product with a stock movement.
- **Accueil card.** From the second session on, if availability is `default`, Accueil shows one inline card
  («Recevoir une alerte quand un article est bientôt épuisé» with the button «Activer les alertes»). It appears at
  the first of these moments: a product of the household becomes running low on this device, or the household
  reaches five products. «Plus tard» hides it for 30 days (timestamp in IndexedDB `meta`).
- **Settings.** Réglages › Notifications always shows the button «Activer les notifications» when availability is
  `default`.

The button's click handler calls `enablePush()` (contract: `EnablePushResult`). `Notification.requestPermission()`
is the first awaited call in the handler, with no `await` before it, because WebKit only accepts a permission
request made directly in response to a user gesture. The flow is:

1. If `!pushSupported()`, return `unsupported`.
2. `const permission = await Notification.requestPermission()`. If `denied`, return `denied`; if still `default`
   (the user closed the prompt), return `dismissed`.
3. `const reg = await navigator.serviceWorker.ready`.
4. `let sub = await reg.pushManager.getSubscription()`; if null,
   `sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`. A `subscribe()` error
   on iOS outside standalone mode returns `not-installed`; any other error returns `error`.
5. Save the subscription (§1.4). On failure return `save-failed`; the interface shows «Réessayer».
6. Return `{ ok: true }`. The card leaves with the list-remove motion defined in design `02`.

`userVisibleOnly: true` is mandatory: WebKit does not allow push messages that display nothing.

### 1.4 Saving the subscription

The client writes the row directly through PostgREST:

```
supabase.from('push_subscriptions').upsert(
  { user_id, endpoint, p256dh, auth, user_agent: navigator.userAgent.slice(0, 400), last_seen_at: now },
  { onConflict: 'endpoint' })
```

`p256dh` and `auth` come from `subscription.toJSON().keys` (base64url strings). After a successful write the client
updates the local record `{ userId, endpoint, vapidPublicKey, savedAt }`.

**Endpoint owned by another user.** If the same device was used by another account that did not sign out cleanly,
the endpoint already exists with another `user_id`. Row-level security then rejects the upsert (Postgres error
`42501`). The client does not try to take over the row. It calls `subscription.unsubscribe()`, which makes the old
endpoint dead at Apple, creates a fresh subscription with `subscribe()` (permission is already granted), and inserts
the new endpoint. The orphaned row of the other account is pruned the next time a push to it returns 404 or 410
(§3.7).

### 1.5 Every app start: refresh and re-subscribe

`reconcilePush()` runs once per cold start, and again when the app returns to the foreground if the last run is
more than 12 hours old. It runs only when the app is installed, a user is signed in, the device is online and
`Notification.permission === 'granted'`. It never shows a permission prompt.

1. `reg = await navigator.serviceWorker.ready`; `sub = await reg.pushManager.getSubscription()`; read the local
   record and any `PendingSubscriptionChange` left by the service worker (§1.7), then clear the latter.
2. **No subscription.** If `sub` is null, call `subscribe()` with the current VAPID key. Whether WebKit allows this
   without a fresh gesture once permission is granted is not documented; the code tries it and, if it throws,
   sets availability to `granted-not-subscribed` so the user can re-enable from a tap. On success, save the new
   subscription (§1.4) and delete the row of the old endpoint from the local record, if any
   (`delete … where endpoint = old`; row-level security restricts it to the user's own rows).
3. **Key rotated.** If the local record's `vapidPublicKey` differs from the key in this build, call
   `sub.unsubscribe()`, subscribe again, save, and delete the old row.
4. **Endpoint changed or other user.** If `sub.endpoint` differs from the local record's endpoint, or the local
   record belongs to another user id, save `sub` (upsert) and delete the old endpoint's row if it belonged to this
   user.
5. **Unchanged.** Otherwise update `last_seen_at = now()` for `endpoint = sub.endpoint`, selecting the updated row.
   If no row was updated (the server pruned it after errors), upsert the full row.

If permission is `denied` at start while a local record exists, the client deletes its row by endpoint and clears
the record. Failures in reconciliation are logged and retried at the next start; they never block the interface.

`last_seen_at` lets the architecture owner add a cleanup of rows not seen for a long time (see the issue list in the
handover); the push pipeline itself does not read it.

### 1.6 VAPID public key delivery and rotation

The VAPID public key is the uncompressed P-256 public point (65 bytes, `0x04 ‖ x ‖ y`) encoded as base64url
(87 characters). It is delivered to the client at build time through the Vite environment variable
`VITE_VAPID_PUBLIC_KEY`, set in Vercel project settings for every environment and in `.env.local` for development.
The client decodes it to a `Uint8Array` for `applicationServerKey`. The service worker receives the same value at
build time (vite-plugin-pwa compiles `sw.ts` with the same `import.meta.env`).

The private key is generated once with `npx @pushforge/builder vapid`, stored as the Edge Function secret
`VAPID_PRIVATE_JWK` (the JWK JSON string), and never committed. If the CLI prints the public key only as a JWK
(`x`, `y`), the base64url point is derived as above. Regenerating the key pair invalidates every existing
subscription: a rotation is a deliberate release in which the new public key ships in the build and step 3 of §1.5
re-subscribes every device as it starts.

### 1.7 `pushsubscriptionchange`

Support for this event on iOS is reported as absent (WebKit bug 273063) and cannot be relied on. The design does
not depend on it: §1.5 detects a lost or changed subscription at every start. The service worker still handles the
event for browsers that fire it. It cannot write to Supabase (it has no user session), so it:

1. takes `event.newSubscription` if present; otherwise, if `event.oldSubscription` is present, calls
   `self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })` with the build key,
   inside `event.waitUntil`, and catches any error;
2. writes a `PendingSubscriptionChange` (old endpoint, new subscription JSON or null) to IndexedDB database
   `cellier-sw`, store `push`, key `change`.

The page reads and clears that record in step 1 of §1.5, which then saves the new endpoint and deletes the old one.

### 1.8 Sign-out

Before calling `supabase.auth.signOut()` the client:

1. deletes its row: `delete from push_subscriptions where endpoint = <local endpoint>` (row-level security limits it
   to the user's rows), with a 3-second timeout;
2. calls `subscription.unsubscribe()` whether or not step 1 succeeded, so the endpoint becomes dead at Apple;
3. clears the local record.

If the device is offline, step 1 fails but step 2 still makes the endpoint dead; the server row is pruned at the next
push to it (404 or 410). The next account that signs in on the device starts at availability `default` or
`granted-not-subscribed` and subscribes a fresh endpoint.

### 1.9 What is lost when the app is deleted from the Home Screen

Deleting the Home Screen icon removes the web app's storage (IndexedDB, local storage, caches), its service worker,
its push subscription and its notification permission. Nothing runs at deletion, so the server row remains. The next
push to that endpoint is expected to return 410 (Apple: "device token expired") or 404, and `notification_complete`
deletes the row. If Apple keeps answering 2xx for a dead endpoint (reported in forums), the row stays harmlessly
until a cleanup job removes rows with an old `last_seen_at`. Reinstalling is a new app: the user signs in again, the
pending outbox of the deleted app is lost, the permission prompt is shown again from a tap (§1.3), and a new endpoint
is saved. Signing in from Safari does not carry over to the installed app either, because the two have separate
storage.

### 1.10 Per-member preferences

`household_members.notify_running_low` and `household_members.notify_digest` (both default true) decide whether a
member receives running-low alerts and the 18:00 digest. They are per member of a household, so they apply to all of
that user's devices. They are changed on the Notifications settings page with two switches:

- «Articles bientôt épuisés» → mutation `member.updateSelf` with `{ notifyRunningLow: boolean }`;
- «Résumé de 18 h» → mutation `member.updateSelf` with `{ notifyDigest: boolean }`.

The mutation goes through the normal sync outbox and `apply_mutations` (per-field last-writer-wins). Following design
`03` §2.1, these switches are disabled while offline, with the note «Connexion nécessaire pour modifier les
notifications.». A member never receives a running-low alert for a change they made themselves (the trigger records
them as `actor_id` and the claim excludes them, §3.1 and §3.4). Turning notifications off for one device only is done
in iOS Settings, not in Cellier.

---

## 2. Service worker: push and notificationclick

### 2.1 Payload format

Every push message carries one JSON object (contract `PushPayload`), UTF-8 encoded, at most 3 000 bytes before
encryption (Apple's limit is 4 KB):

```json
{
  "web_push": 8030,
  "notification": {
    "title": "Pâtes : plus que 1",
    "body": "Seuil d’alerte atteint. Ajout automatique à Courses.",
    "navigate": "https://cellier-one.vercel.app/items/3f6c…",
    "tag": "produit-3f6c…",
    "lang": "fr",
    "dir": "ltr",
    "silent": false,
    "data": {
      "v": 1, "kind": "running_low", "householdId": "…", "productIds": ["3f6c…"],
      "path": "/items/3f6c…", "outboxIds": [412], "sentAt": "2026-11-10T17:02:41.120Z"
    }
  }
}
```

Rules:

- `web_push` is `8030` and the message is **immutable**: there is no top-level `mutable` member. On iOS 18.4 and
  later the system displays the notification itself without running the service worker, which removes the main
  failure mode of iOS push (a slow or crashing worker that shows nothing).
- `title` and `navigate` are always present and non-empty; both are required by the declarative format. `navigate`
  is an absolute URL on the app origin (`CELLIER_APP_URL` + `data.path`).
- Only `title`, `body`, `navigate`, `tag`, `lang`, `dir`, `silent` and `data` are sent. `icon`, `image`, `actions`
  and `badge` are omitted: iOS ignores or mishandles them, and an action without its own `navigate` would make the
  declarative message invalid. `app_badge` is omitted too (§2.5).
- The same object works on the classic path (iOS 16.4 to 18.3): the service worker parses it and passes
  `notification` to `showNotification`.

### 2.2 The classic `push` handler

Every push must show a notification. The handler in `src/sw.ts` is:

```
self.addEventListener('push', (event) => {
  // iOS 18.4+: a declarative message whose notification the system shows itself.
  if ((event as PushEvent & { notification?: Notification }).notification) return;
  event.waitUntil(showFromPush(event));
});
```

`showFromPush` parses `event.data.json()` inside `try`. If the result has `web_push === 8030` and a non-empty
`notification.title`, it calls `self.registration.showNotification(title, { body, tag, lang, dir, silent: false,
data })`. If parsing fails or the shape is wrong, it still shows a fallback: title «Cellier», body «Du nouveau dans
votre cellier.», tag `cellier`, data `{ path: '/' }`. Nothing is awaited before `showNotification` except the
synchronous parse; no network request, no IndexedDB read, no `clients.matchAll` gating.

The early return covers the case where a WebKit version dispatches the `push` event for a declarative message: the
system then shows the declarative notification as its fallback, so returning without `showNotification` never
results in a push without a notification, and there is no risk of a duplicate if `tag` replacement does not work.

### 2.3 Tags and collapsing

| Notification | `tag` | Effect |
|---|---|---|
| Running low, one product | `produit-<productId>` | A later alert for the same product replaces the earlier one. |
| Running low, grouped | `courses-<householdId>` | A later group replaces the earlier group. |
| Daily digest | `digest-<householdId>` | Today's digest replaces yesterday's if it was not dismissed. |

The push `Topic` header (§3.5) is derived from the same tag, so the push service also replaces a message still
queued for an offline device by a newer one with the same tag.

### 2.4 Deep links and `notificationclick`

Routes opened from notifications:

| Notification | Path |
|---|---|
| Running low, one product | `/items/<productId>` (product detail) |
| Running low, grouped | `/groceries` |
| Daily digest | `/groceries` |
| Fallback notification | `/` (Accueil) |

On iOS 18.4 and later the system opens `navigate` in the installed app itself; the router handles the path on load.
On the classic path, and whenever the service worker receives `notificationclick`:

1. `event.notification.close()`.
2. Take `data.path`; if absent, take the path of `event.notification.navigate`; accept it only if it matches
   `^/$`, `^/groceries$` or `^/items/[0-9a-f-]{36}$`, otherwise use `/`.
3. Inside `event.waitUntil`: `clients.matchAll({ type: 'window', includeUncontrolled: true })`. If a window of the
   origin exists, `focus()` it and `postMessage({ type: 'cellier:navigate', path, data })` (contract
   `SwNavigateMessage`). Otherwise `clients.openWindow(path)`.

`WindowClient.navigate()` is not used: its iOS behaviour is unverified and it would reload the app. The page listens
for `cellier:navigate` on `navigator.serviceWorker` and calls the router, which waits for an open scanner or an
unsaved sheet as design `03` §1.6 describes. Opening the app from a notification is a foreground event, so the sync
engine pulls immediately; the product detail screen therefore shows the current count.

### 2.5 Badge

The app icon badge shows the number of products of the household currently running low and not dismissed on this
device for Accueil (`runningLowView(...).length`, §5.10). The page sets it after every forecast recomputation with
`navigator.setAppBadge(n)`, or `navigator.clearAppBadge()` when `n` is 0, guarded by `'setAppBadge' in navigator`
and wrapped in `catch`. Push messages do not carry a badge: the server does not know the client's forecast-based
count, the declarative `app_badge` member is placed differently in WebKit's shipped example and in the W3C draft, and
calling the Badging API from the service worker on iOS is unverified. The badge is therefore exact whenever the app
has been opened and may be stale while it has not, which is acceptable for a state indicator.

---

## 3. Server pipeline: from a stock change to a delivered notification

The pipeline is implemented in SQL by the architecture owner and in the Edge Function `send-push`. This section
describes it so the Edge Function and its tests can be written against it.

```
apply_mutations ─▶ stock_movements ─▶ stock (cache)
                                         │ trigger (after each change)
                                         ▼
                         private.low_stock_state  ── transition to low ──▶ private.notification_outbox
                                                                              ▲            │
pg_cron 'cellier-digest' (hourly) ─ enqueue_daily_digests() at 18:00 Paris ──┘            │
pg_cron 'cellier-notify' (every minute) ─ kick_notification_sender() ─ pg_net POST ─▶ send-push
                                                                                           │
             notification_claim() ◀── service role ──┤   Web Push (encrypted) ──▶ Apple push service ──▶ iPhone
             notification_complete() ◀───────────────┘
```

### 3.1 Running-low state and outbox rows (database trigger)

A trigger runs after every insert, update or delete on `public.stock`, and after updates of
`products.min_quantity`, `products.low_alert` and `products.deleted_at`. For the product concerned it:

1. recomputes the **household total** `t`: the sum of `stock.quantity` over pantries whose `deleted_at` is null, or 0
   if the product is deleted;
2. computes the **effective minimum**
   `m = coalesce(products.min_quantity, greatest(1, ceil(0.25 × product_forecasts.usual_quantity)), 1)`;
3. computes the **clear level** `c = greatest(m + 1, ceil(0.5 × coalesce(usual_quantity, 0)))`;
4. reads `private.low_stock_state` (`is_low`, `total_quantity`) for the product, creating the row if needed, and
   applies:
   - transition to low when `not is_low and low_alert and t ≤ m`;
   - transition to not low when `is_low and (t ≥ c or not low_alert or product deleted)`;
   - otherwise `is_low` is unchanged; `total_quantity` is always updated to `t`;
5. on a transition to low only, inserts into `private.notification_outbox` a row with `kind = 'running_low'`,
   `household_id`, `product_id`, `actor_id = auth.uid()` (the member whose mutation caused the change),
   `status = 'pending'` and `not_before = now() + 20 seconds`.

Because the outbox row is written in the same transaction as the stock change, a rolled-back change sends nothing
and a committed one cannot lose its notification. The hysteresis gap between `m` and `c` means a product that
oscillates around its minimum produces one notification per depletion, not one per withdrawal. The 20-second
`not_before` debounce lets a burst of withdrawals (several products emptied while cooking) be grouped into one
notification (§3.6).

Example: pasta with no explicit minimum and a usual quantity of 6 has `m = max(1, ceil(1.5)) = 2` and
`c = max(3, 3) = 3`. Going from 3 to 2 packs creates one outbox row; going back to 3 or more clears the state.

### 3.2 The every-minute kick (`cellier-notify`)

The pg_cron job `cellier-notify` runs every minute and calls `private.kick_notification_sender()`, which:

1. **requeues stuck rows**: rows in status `sending` whose `claimed_at` is more than 5 minutes old go back to
   `pending` when `attempts < 5`, otherwise to `failed`;
2. **kicks the sender only when needed**: if at least one `pending` row has `not_before ≤ now()`, it calls
   `net.http_post` to `<vault secret cellier_functions_url>/send-push` with the header
   `x-cellier-secret: <vault secret cellier_internal_secret>` and an empty JSON body.

pg_net is asynchronous and never retries; its response is only logged in `net._http_response`. The requeue in step 1
is what makes delivery eventually happen: a request that never reached the function leaves its rows `pending` (they
are kicked again the next minute), and a function that died mid-way leaves rows in `sending`, which are requeued
after 5 minutes, up to 5 attempts. The function responds immediately (§3.5), so pg_net's default 2-second timeout is
normally enough; if a cold start exceeds it, the worst case is a second kick a minute later, which is harmless
because claiming is exclusive.

End-to-end latency of a running-low alert is therefore 20 seconds (debounce) plus up to 60 seconds (cron tick) plus
the send time: typically 30 to 90 seconds.

### 3.3 The hourly digest job (`cellier-digest`)

The pg_cron job `cellier-digest` runs every hour at minute 0 UTC and calls `private.enqueue_daily_digests()`. The
function returns immediately unless the Europe/Paris local hour is 18. This makes the digest fire at 18:00 Paris time
all year without depending on pg_cron's time zone setting (Paris offsets are whole hours, so minute 0 UTC is minute 0
Paris). At 18:00 it inserts one outbox row per qualifying household with `kind = 'digest'`,
`dedupe_key = 'digest:<household_id>:<Paris date>'` (unique, so a second run the same day inserts nothing) and
`not_before = now()`. A household qualifies when at least one of these holds:

- one of its products has `low_stock_state.is_low`;
- one of its `product_forecasts.run_out_at` is before `now() + 3 days`;
- its `household_forecasts.next_trip_on` is on or before the next Paris calendar day.

The digest row is then delivered by the next `cellier-notify` tick. Content rules are in §4.

### 3.4 The two service-role RPCs

Both functions are callable only by the `service_role` (they are not granted to `authenticated` or `anon`). The
Edge Function calls them through supabase-js with the secret key.

**`public.notification_claim(p_limit integer default 50) returns jsonb`.** Selects due rows (`status = 'pending'`
and `not_before ≤ now()`) in id order with `FOR UPDATE SKIP LOCKED`, marks them `sending` with
`attempts = attempts + 1` and `claimed_at = now()`, and returns `NotificationClaimResult`:

```
{ "items": [ { "outboxId": 412, "kind": "running_low", "householdId": "…", "householdName": "Maison",
               "product": { "id": "…", "name": "Pâtes", "totalQuantity": 1, "minQuantity": 2 },
               "digest": null,
               "recipients": [ { "userId": "…", "subscriptions": [ { "id": "…", "endpoint": "https://web.push.apple.com/…",
                                                                    "p256dh": "…", "auth": "…" } ] } ] } ] }
```

For `running_low`, recipients are the household's members with `notify_running_low` who are not the `actor_id` and
have at least one subscription; `product` is null if the product no longer exists. For `digest`, recipients are the
members with `notify_digest` who have at least one subscription, and `digest` holds `lowProducts`
(`{ id, name, totalQuantity }`), `runningOutSoon` (`{ id, name, runOutAt }`) and `nextTripOn` (a Paris date or null).
`SKIP LOCKED` plus the `sending` status mean two overlapping invocations never claim the same row.

**`public.notification_complete(p_report jsonb) returns void`.** Takes `NotificationCompleteReport`:

```
{ "outbox": [ { "outboxId": 412, "status": "sent", "error": null } ],
  "subscriptions": [ { "id": "…", "result": "ok" } ] }
```

It sets each outbox row's `status`, `sent_at` (for `sent`) and `last_error`. For subscriptions: `gone` deletes the
row; `ok` sets `last_success_at = now()` and `failure_count = 0`; `error` increments `failure_count` and deletes the
row when it reaches 10 consecutive errors. Outbox rows that the function deliberately leaves out of the report stay
in `sending` and are retried by the requeue of §3.2 (§3.7 says when).

### 3.5 The `send-push` Edge Function

Location `supabase/functions/send-push/index.ts`, runtime Deno, deployed with `verify_jwt = false` in
`supabase/config.toml` (the caller is the database, not a user).

**Dependencies (pinned exactly in the function's `deno.json`):**

- `npm:@pushforge/builder@2.0.5`, the Web Push library chosen in research 12 (Web Crypto only, Deno supported).
  2.0.5 is the latest version on the npm registry on 2026-11-10. Its documented call is
  `buildPushHTTPRequest({ privateJWK, subscription: { endpoint, keys: { p256dh, auth } }, message: { payload,
  adminContact, options: { ttl, urgency, topic } } })`, returning `{ endpoint, headers, body }` that the function
  sends with `fetch(endpoint, { method: 'POST', headers, body })`. `payload` is passed as the `PushPayload` object
  (the library serialises it); `ttl` is capped at 86 400 seconds by the library.
- `npm:@supabase/supabase-js@2.119.0` (latest on 2026-11-10), client created with
  `{ auth: { persistSession: false, autoRefreshToken: false } }`.

**Secrets and environment:**

| Name | Content |
|---|---|
| `CELLIER_INTERNAL_SECRET` | 32 random bytes as hex; the same value as the Vault secret `cellier_internal_secret`. |
| `VAPID_PRIVATE_JWK` | The VAPID private key as a JWK JSON string. |
| `VAPID_SUBJECT` | A real `mailto:` address of the maintainer (Apple rejects placeholder subjects with `403 BadJwtToken`). |
| `CELLIER_APP_URL` | The production origin, for example `https://cellier-one.vercel.app`, without trailing slash. |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEYS` | Injected by Supabase. The function uses `JSON.parse(SUPABASE_SECRET_KEYS).default`, falling back to the legacy `SUPABASE_SERVICE_ROLE_KEY` when the former is absent. |

**Request handling:**

1. Reject anything but `POST` (405).
2. Compare the `x-cellier-secret` header with `CELLIER_INTERNAL_SECRET` in constant time (compare SHA-256 digests of
   both strings byte by byte); mismatch or missing secret → 401 with no body detail.
3. If a run is already in progress in this instance (module-level flag), answer
   `202 { accepted: true, alreadyRunning: true }`; the running loop will pick up the new rows.
4. Otherwise start `run()` with `EdgeRuntime.waitUntil(run())` and answer `202 { accepted: true,
   alreadyRunning: false }` immediately. The work continues after the response; the pg_net timeout no longer matters.

**`run()`**, with `start = Date.now()`:

1. **Claim.** Call `notification_claim(50)`. If `items` is empty, stop.
2. **Plan messages.** Build the list of messages for this round (§3.6): one message per (recipient, digest item) and
   one message per (household, recipient) for the running-low items of that household in this round, grouping
   items whose `product` is not null and still at or under its minimum. Every message is sent to each of the
   recipient's subscriptions.
3. **Send.** Run the sends through a pool of 6 concurrent requests. Each request has a 10-second timeout
   (`AbortSignal.timeout(10_000)`) and its response body is cancelled after reading the status. Headers per §3.5
   below.
4. **Report.** Compute the outbox statuses and subscription results (§3.7) and call `notification_complete`.
5. **Loop.** If the claim returned 50 items, fewer than 60 seconds have passed since `start`, and fewer than 300
   push requests have been made in this invocation, go back to step 1. Otherwise stop. Remaining due rows are taken
   by the next minute's kick.

A `beforeunload` listener logs an `event: 'shutdown'` line if the runtime stops the function early; claimed rows then
stay in `sending` and are requeued after 5 minutes.

**Web Push headers** (passed through the library's `options`):

| Kind | `TTL` | `Urgency` | `Topic` |
|---|---|---|---|
| `running_low` | 43 200 s (12 h): an evening alert is still useful the next morning, and older ones are stale. | `normal` | `base64url(SHA-256(tag))`, first 32 characters |
| `digest` | 14 400 s (4 h): a «demain» digest delivered after 22:00 would be misleading. | `normal` | same rule |

`Topic` must be at most 32 characters of the base64url alphabet (RFC 8030 §5.4, and Apple's documentation); a raw
UUID with hyphens is 36 characters, hence the hash. `Urgency: high` is not used: neither notification is
time-critical, and Focus modes may defer delivery anyway.

### 3.6 Grouping and French copy

All strings come from one function `compose()` in the Edge Function, with the same typography rules as the app
catalogue (design `03` §0): a no-break space U+00A0 before `:`, a typographic apostrophe ’, the single-character
ellipsis …. Product names are trimmed and cut to 40 characters with «…». Titles are capped at 60 characters and
bodies at 180 characters. Name lists use the household's product names as stored, joined with «, » and a final
« et », at most three names, then « et {n} autres» (`n ≥ 2`) or « et 1 autre».

**Running low.** Within one claim round, the running-low items of a household are filtered, then grouped per
recipient:

- An item is **skipped** (no message, status `skipped`) when `product` is null (deleted) or when
  `product.totalQuantity > product.minQuantity` (restocked during the debounce window). Error codes:
  `product_gone`, `no_longer_low`.
- An item with no recipient is `skipped` with `no_recipient` (for example, a one-member household whose only member
  made the change).
- For each recipient, the remaining items of the household form either one single message or one grouped message.

| Case | Title | Body | Path | Tag |
|---|---|---|---|---|
| One product, total ≥ 1 | «{name} : plus que {q}» | «Seuil d’alerte atteint. Ajout automatique à Courses.» | `/items/{id}` | `produit-{id}` |
| One product, total 0 | «{name} : stock épuisé» | same | `/items/{id}` | `produit-{id}` |
| Two or more products | «{n} articles à racheter» | the name list, for example «Pâtes, Lait, Café et 2 autres» | `/groceries` | `courses-{householdId}` |

Examples: «Pâtes : plus que 1»; «Huile d’olive : stock épuisé»; «3 articles à racheter» / «Pâtes, Lait et Café».
The word «article» follows the app's vocabulary (design `03` calls a product an «article»). Phrasing avoids
agreeing an adjective with the product name, whose gender is unknown.

**Digest.** Composition rules are in §4.

### 3.7 Outcomes, statuses and what is reported

Each push request has one outcome:

| HTTP result | Meaning | Subscription result | Effect on the item |
|---|---|---|---|
| 200, 201, 202 | Accepted by the push service | `ok` | counts as delivered |
| 404 (Apple `BadPath`, RFC 8030 expired subscription), 410 (Apple: token expired) | Endpoint dead | `gone` | not delivered |
| 400, 401, 403 (`BadJwtToken`), 413 (`PayloadTooLarge`) | Fault of the sender (key, subject, payload), not of the device | **not reported** | `sender_fault_<status>` |
| 429, 5xx, network error, timeout | Transient | `error` | transient |

Sender faults are not reported as subscription errors on purpose: a wrong VAPID key would otherwise count an error
against every subscription and delete them all after 10 runs. They are logged at error level instead.

A subscription can receive several messages in one invocation (a group and a digest). Its single reported result is
`gone` if any request said gone, else `ok` if any request succeeded, else `error` if any was transient; a
subscription with only sender faults is omitted.

Outbox status per item (an item is "in" every message that names it):

- `sent` if at least one request carrying it succeeded;
- `skipped` with its code when it was filtered out (§3.6) or every recipient's subscriptions were `gone`
  (`all_gone`);
- **omitted from the report** when nothing succeeded and at least one request was transient: the row stays in
  `sending` and the requeue of §3.2 retries it after 5 minutes, up to 5 attempts, after which it becomes `failed`;
- `failed` with `sender_fault_<status>` when all requests were sender faults.

A retry re-sends to every recipient of the item, including any whose earlier request succeeded; the identical `tag`
makes the second copy replace the first on the device.

### 3.8 Budget against the free plan, and logging

Supabase free plan limits (limits page, read 2026-11-10): 150 seconds of wall-clock time per invocation, 2 seconds
of CPU time per request (asynchronous I/O excluded), 256 MB of memory, 500 000 invocations included. pg_cron is used
for 2 jobs (Supabase recommends at most 8 running concurrently).

- **Wall clock.** New rounds start only in the first 60 seconds; each send has a 10-second timeout and the pool has
  6 lanes, so the last round ends well before 100 seconds and the report is written long before 150 seconds and
  before the 5-minute requeue.
- **CPU.** Each push costs one ECDH derivation, HKDF, AES-GCM encryption and one ECDSA signature for the VAPID JWT,
  all native Web Crypto, in the order of a few milliseconds. The cap of 300 push requests per invocation keeps the
  CPU well under 2 seconds; a household app normally sends fewer than 10 per invocation. The Edge Function tests
  (§6.2) measure CPU per push and the cap is lowered if needed.
- **Invocations.** At most one kick per minute and only when a row is due: under 1 440 per day in the worst case and
  typically a few dozen, far below the included quota.
- **Pausing.** A free project is paused after a week without user activity; whether cron-driven calls count as
  activity is not documented. Notifications therefore stop if nobody opens the app for a week. This is accepted for
  v1 and mentioned in the README for the household.

**Logging.** One JSON line per invocation (contract `SendPushInvocationLog`): counts of claimed, sent, skipped,
failed and retried items, messages, subscription results, sender faults, rounds, duration and `SB_EXECUTION_ID`.
One warning line per non-ok push request with `outboxId`, kind, HTTP status, Apple `reason` if present (read from the
JSON body when the status is 4xx) and the endpoint **host** only (for example `web.push.apple.com`). Endpoints, keys,
product names, household names and payloads are never logged.

---

## 4. Daily digest: content rules and copy

The digest is one notification per member with `notify_digest`, sent at about 18:00 Paris time to households that
qualify (§3.3). The Edge Function composes it from the claim's `digest` object.

**Content.**

1. `low` = `lowProducts`, sorted by `totalQuantity` ascending, then name (French collation).
2. `soon` = `runningOutSoon` without the products already in `low`, without entries whose `runOutAt` is more than
   30 days in the past (a forecast nobody refreshed), sorted by `runOutAt` ascending.
3. `n = |low| + |soon|`. If `n = 0`, the item is `skipped` with `empty_digest`, even when the trip is tomorrow: a
   reminder with nothing to buy is noise.
4. `trip` is computed from `nextTripOn` and today's Paris date: `today` when `nextTripOn ≤ today`, `tomorrow` when it
   is the next day, otherwise none.

**Title.**

| Case | Title |
|---|---|
| `trip = tomorrow` | «Courses demain : {n} article(s)» |
| `trip = today` | «Courses : {n} article(s) à racheter» |
| otherwise | «{n} article(s) à racheter bientôt» |

(«article» when `n = 1`, «articles» otherwise.)

**Body.** Up to two segments separated by « · »:

- if `low` is not empty: «Sous le seuil : » + name list of `low`;
- if `soon` is not empty: «Bientôt épuisé : » + name list of `soon`.

Each name list shows at most three names, then « +{k}». Example: title «Courses demain : 5 articles», body
«Sous le seuil : Pâtes, Lait · Bientôt épuisé : Café, Riz +1».

**Delivery.** Path `/groceries`, tag `digest-<householdId>`, TTL 4 hours, urgency `normal`.

---

## 5. Forecasting

### 5.1 What is computed where

| Value | Where | Used by |
|---|---|---|
| Household totals, rates, days left, run-out bands, usual quantity, threshold state, forecast state, confidence, cadence, next trip, Accueil running-low list, Courses list, all dates and their wording | **Client**, module `src/domain/forecast/` (pure functions, the reference implementation) | Everything the interface shows |
| `public.product_forecasts`, `public.household_forecasts` | **Client publishes** after each successful pull (§5.9) | Daily digest qualification and content; the server's effective minimum uses `usual_quantity` |
| `private.low_stock_state` (threshold rule with hysteresis) | **Database trigger** (§3.1), the only forecast-related computation in SQL | Running-low push alerts and the digest |

The client and the server apply the same threshold rule with the same formulas (§5.6), so a product announced as
running low by a push is also on the Accueil list. The forecast rule (four days left) exists only on the client; it
adds products to the lists earlier but never sends a push by itself. The digest is the server's only use of forecast
values, and it reads them from the published tables.

The module is dependency-free TypeScript. It never reads the clock or the store: `now`, products, movements and
dismissals are arguments. Its public signatures are in `contracts/notifications.ts`; defaults are in §5.13.

Notation: times in milliseconds since epoch, durations in days (`DAY = 86 400 000 ms`); `W` window (90 days), `H`
half-life (30 days), `λ = ln 2 / H`, `k` prior strength (14 weighted days).

### 5.2 Household total reconstructed from the ledger

The ledger `public.stock_movements` holds, for each movement, `kind`, `applied_delta` (integer), `quantity_after`
(quantity of that pantry after the movement), `seq` (server apply order), `created_at`, `client_at`, `product_id`,
`pantry_id`, `reverts_id`. The forecast needs the household total of one product as a step function of time.

`reconstructTotals(productId, movements, deletedPantryIds)`:

1. Keep the product's movements whose pantry is not deleted. Order them by `seq`; pending local movements (not yet
   acknowledged, `seq = null`) come after all server movements, in outbox order.
2. **Effective time.** For each movement, `t = clamp(clientAt ?? createdAt, createdAt − 7 days, createdAt)`; pending
   movements use `clientAt`. Then make times non-decreasing along the order: `t_i = max(t_i, t_{i−1})`. Client time is
   used because a withdrawal recorded offline is applied later by the server, which would otherwise bunch demand at
   sync time; the clamp bounds the trust given to device clocks, and the running maximum keeps the series ordered.
3. **Per-pantry state.** Keep a map pantry → quantity. The first time a pantry appears, its previous quantity is
   `quantity_after − applied_delta` of that movement; this makes the reconstruction exact even when the device only
   holds a recent window of the ledger. For pending movements, `quantity_after` is the optimistic value from the
   overlay.
4. `initialTotal` = the sum of those previous quantities of every pantry seen; after each movement the total is the
   sum of the map, recorded as a point `{ at: t_i, total, movementId, kind }`.

The last point's total equals the cache total (`stock` rows of live pantries plus the overlay); if they differ (a
movement missing from the local window), the cache total is authoritative for the current state and the series is
used only for the past.

### 5.3 Demand events

Only `kind = 'consume'` with `applied_delta < 0` counts as demand, with quantity `−applied_delta`. A consume that a
later `correction` reverts (a movement exists whose `reverts_id` is its id) is excluded; the correction itself is not
demand. `restock`, `discard` (waste), `recount`, `transfer_out`, `transfer_in` and `correction` change the total, and
therefore the exposure, but are not demand. A transfer between two live pantries leaves the total unchanged.

### 5.4 Rate, days of cover and the 80 % band

**Reference time.** `asOf = min(now, max(start of the current Paris day, effective time of the product's last
movement))`. The rate is evaluated at `asOf`, not at `now`. Between two movements of the product and within one day,
the estimate and the run-out date are therefore constant; only "days left" decreases with time. This prevents a
date from drifting by minutes on every render, keeps memoisation valid (§5.15), and keeps published rows stable.

**Weights and window.** `w(t) = exp(−λ · (asOf − t) / DAY)`; the window is `[asOf − W, asOf]`.

**Weighted demand.** `Q = Σ min(q_i, cap) · w(t_i)` over demand events in the window, with
`cap = usualQuantity` (§5.5), or no cap when the usual quantity is unknown. A single bulk withdrawal therefore
cannot dominate the rate.

**Exposure.** `E = Σ (w(b) − w(a)) / λ` over the intervals `[a, b]` inside the window during which the household
total was greater than 0 (in days). Time out of stock is excluded: when nothing is in the house nothing can be
consumed, so the rate is the **in-stock** rate.

**Shrinkage to the category prior (Gamma–Poisson).** With the prior of the product's category (§5.13),
`a0 = priorRate · k`, `b0 = k`:

```
ratePerDay = (a0 + Q) / (b0 + E)          shape = a0 + Q          rawRate = E > 0 ? Q / E : 0
```

A new product starts at its category's rate; with a full window of history (maximum `E` about 38 weighted days) the
prior keeps about a quarter of the weight. A product that stops being used decays toward 0 within about two
half-lives.

**Days of cover.** `cover = total / ratePerDay` (0 when the total is 0; infinite when the rate is 0).

**Run-out band.** With `σ = 1 / √shape` and `z = 1.2816`:

```
median   = asOf + cover · DAY
earliest = asOf + cover · exp(−z · σ) · DAY        (about the 10th percentile)
latest   = asOf + cover · exp(+z · σ) · DAY        (about the 90th percentile)
daysLeft = max(0, (median − now) / DAY)
```

The log-normal approximation is the research note's; its calibration is a test (§6.1).

### 5.5 Usual quantity

There is no "usual quantity" column; the module derives it from the ledger. Group the product's `restock` movements
into restock sessions (consecutive effective times at most 6 hours apart). The **post-restock level** of a session
is the household total right after its last restock. `usualQuantity` = `ceil(median)` of the post-restock levels of
the last 5 sessions that started within the last 180 days. If there is no such session, it is the maximum total
reached within the last 180 days if that is above 0, otherwise null. It is never 0.

### 5.6 Effective minimum, clear level and the threshold state

These are the server formulas of §3.1, reproduced exactly:

```
m = minQuantity ?? (usual != null ? max(1, ceil(0.25 · usual)) : 1)
c = max(m + 1, ceil(0.5 · (usual ?? 0)))
```

`replayThresholdState` walks the total series of §5.2 from a non-low state and applies, after each point, with the
product's **current** settings: become low when `!low && lowAlert && total ≤ m`; stop being low when
`low && (total ≥ c || !lowAlert)`. It then applies the same rule once more to the current total (as the server does
when a setting changes), and returns false if the product is deleted. A product with no movement is not low, as on
the server (no stock row, no trigger).

The client replays history with the current `m` and `c`, whereas the server evaluated each change with the values of
the time. The two can differ only when settings or the usual quantity changed while the total was between `m` and
`c`; the client value is the one shown.

### 5.7 One product: `forecastProduct`

For one product the module computes the series, demand events, usual quantity, `m`, `c`, the rate at `asOf`, the band
and:

- **Events** = number of demand events in the window.
- **Confidence**: `high` when events ≥ 6, exposure ≥ 20 weighted days and the household has a cadence (§5.8);
  `medium` when events ≥ 3; otherwise `low`.
- **Usable forecast** when events ≥ 3 (`minEventsForForecast`), the rate is above 0 and the total is above 0. This
  is stricter than the research note (2 events) so that every forecast the interface shows has at least medium
  confidence, as the design's honesty rules require (design `03` §3.4). Without a usable forecast, `daysLeft` and
  `runOut` are null (or `daysLeft = 0` when the total is 0).
- **Forecast rule**: `lowByForecast = usable && daysLeft ≤ leadTime + safety` (2 + 2 = 4 days). It needs no
  hysteresis of its own because, with the rate frozen at `asOf`, days left only rise on a restock, a recount upward,
  a transfer in, or at the daily re-evaluation.
- **Running low**: `runningLow = lowAlert && !deleted && (lowByThreshold || lowByForecast)`.
- **Reason**: `out` when the total is 0, else `threshold` when `lowByThreshold`, else `forecast`.

Products whose `lowAlert` is false are never running low and never appear in Accueil's list or in Courses.

### 5.8 Shopping cadence and next trip

**Cadence.** Take the effective times of every `restock` movement with `applied_delta > 0` of the household (all
products, live pantries) within the last 180 days, and merge them into sessions (a new session starts when the gap to
the previous restock exceeds 6 hours). With fewer than 3 sessions there is no cadence. Otherwise, over the gaps
between the last 12 session starts (in days):

```
medianGap     = median(gaps)
IQR           = q75(gaps) − q25(gaps)               (linear interpolation)
usualWeekday  = most frequent Paris weekday of the session starts
confidence    = high if sessions ≥ 6 and IQR ≤ 0.5 · medianGap; medium if sessions ≥ 4; otherwise low
nextAt        = max(lastSessionStart + medianGap · DAY, now + 1 DAY)
```

**Next trip.** Let `criticalAt` be the 3rd-soonest `runOut.median` among products with a usable forecast (infinite if
there are fewer than three). Then:

```
tripAt  = max(now, min(cadence ? cadence.nextAt : now + 7 DAY, criticalAt))
tripOn  = cadence ? Paris date of tripAt : null
gapDays = cadence ? cadence.medianGapDays : 7
```

A cluster of three products about to run out pulls the trip forward. Without a cadence, the 7-day default is used
only as the list horizon; no trip date is shown or published.

### 5.9 Publishing forecasts for the server

After each successful pull that reached the household head (`hasMore = false`), and only when the sync outbox is
empty (so published values never include unconfirmed local changes), the client publishes, with a direct upsert
under row-level security:

- `public.product_forecasts` (`household_id`, `product_id`, `rate_per_day`, `rate_shape`, `usual_quantity`,
  `days_left`, `run_out_at`, `confidence`, `computed_at`) for every non-deleted product that has at least one
  movement, built by `toProductForecastRow`: rate rounded to 4 decimals, shape to 3, `days_left` to 2 decimals and
  null without a usable forecast, `run_out_at` = the band median or null;
- `public.household_forecasts` (`household_id`, `cadence_days`, `next_trip_on`, `confidence`, `computed_at`), built by
  `toHouseholdForecastRow`: `cadence_days` and `next_trip_on` null without a cadence, `confidence` = the cadence's or
  `low`.

Only rows whose values **changed materially** are written. A product row is material when any of these holds
(`isMaterialProductChange`):

- there is no previous row;
- `confidence` or `usual_quantity` differs;
- `days_left` changed between null and non-null;
- `|rate − previous rate| > 10 % × max(previous rate, 0.01)`;
- both `run_out_at` are set and differ by 12 hours or more;
- the previous row's `computed_at` is more than 7 days old (a heartbeat, so the server can tell fresh from stale).

A household row is material when there is no previous row, `next_trip_on` or `confidence` differs, `cadence_days`
changed between null and non-null or by 0.5 day or more, or the previous `computed_at` is more than 7 days old.

"Previous row" is the server's value: on the first publication after the app starts, the client reads the household's
rows of both tables with one select each and keeps them in memory, then updates that copy after each upsert. The
publication runs under the Web Lock `cellier:publish-forecasts` (one device tab at a time), is debounced 5 seconds
after the pull, sends at most 200 rows per request, and is skipped while offline. Several members' devices may publish
the same values; the writes are idempotent. The first publication of a new product row may change the server's
effective minimum (through `usual_quantity`), but `low_stock_state` is only re-evaluated at the next stock change of
that product.

### 5.10 Accueil: the running-low view

`runningLowView(forecasts, names, dismissals)` returns the products of the household with:

- `runningLow` true (§5.7), which already excludes deleted products and products with `lowAlert` false;
- no active Accueil dismissal on this device (§5.12).

Order: products at 0 first; then by `daysLeft` ascending, where a product low by threshold without a usable forecast
counts as 0; then by total ascending; then by name (`Intl.Collator('fr')`). Each entry carries its reason, total,
days left, band and confidence. The screen shows «Reste {qty}» and the `ForecastBadge` of design `03` §3.4, and
filters the entries by the current cellier as design `03` §1.1 describes (a product is listed when it has a stock row
in that cellier; whether it is low is still decided on the household total). The app badge count (§2.5) is the length
of this list before the cellier filter.

### 5.11 Courses: the shopping list

`shoppingList(forecasts, names, trip, dismissals, now)` returns `{ trip, entries }`. A product is an entry when it is
not deleted, has `lowAlert` true, has no active Courses dismissal on this device, and either:

- it is running low (reason `out`, `threshold` or `forecast`); or
- it has a usable forecast and `runOut.median ≤ trip.tripAt + trip.gapDays · DAY` (it will run out before the trip
  after next; reason `before-next-trip`).

**Quantity to buy.** `target = usualQuantity ?? c`; `quantity = max(1, ceil(target − total))`. For pasta with a usual
quantity of 6 and 1 left, the suggestion is 5.

**Order.** By `urgencyDays = ((runOut ? runOut.median : now) − trip.tripAt) / DAY` ascending (negative means it runs
out before the next trip; running-low products without a forecast sort as if they ran out now); ties by total
ascending, then name.

**Header.** `formatNextTrip(trip, now)` (§5.14) gives the next-trip line, or nothing without a cadence. The list is
household-wide (it ignores the current cellier).

### 5.12 Dismissals

A user can hide a product from Accueil's list («Masquer») or from Courses («Retirer de la liste»). Dismissals are
stored **only on this device**, in IndexedDB `meta` under key `dismissals:<householdId>`, as `Dismissal` records
`{ productId, scope, dismissedAt, restockAtDismissal }`, where `scope` is `home` or `courses` and
`restockAtDismissal` is the product's `lastRestockAt` at the moment of dismissal. The two scopes are independent.

A dismissal is active while the product's `lastRestockAt` is not newer than `restockAtDismissal`
(`isDismissalActive`). The next `restock` movement of the product, from any member and including a pending local
one, clears it, so the product comes back the next time it runs low. Inactive dismissals and dismissals of deleted
products are removed from storage at the next write. Dismissals never affect push notifications or the digest.

### 5.13 Defaults and category priors

All defaults are starting points to calibrate on synthetic and real ledgers (§6.1).

| Parameter | Default |
|---|---|
| Window `W` | 90 days |
| Half-life `H` | 30 days |
| Prior strength `k` | 14 weighted days |
| Lead time + safety | 2 + 2 days |
| Restock session merge | 6 hours |
| History for cadence and usual quantity | 180 days (last 12 sessions for cadence, last 5 for usual quantity) |
| Minimum sessions for a cadence | 3 |
| Critical count for the trip | 3rd-soonest run-out |
| Trip gap without cadence | 7 days |
| Minimum demand events for a usable forecast | 3 |
| Band `z` | 1.2816 (80 %) |
| Offline client-time trust | 7 days |

Category prior rates, in units (as the household counts them) per in-stock day, for a household of about two people.
All values are **defaults to calibrate**, not measurements. Products with no category or a custom category (no
`template_key`) use `autre`. Strength `k = 14` for every category.

| Slug | Category | Prior rate | | Slug | Category | Prior rate |
|---|---|---|---|---|---|---|
| `legumes` | Légumes | 0.30 | | `soft` | Boissons sans alcool | 0.15 |
| `fruits` | Fruits | 0.40 | | `jus` | Jus & nectars | 0.15 |
| `feculents` | Pâtes, riz & céréales | 0.06 | | `eau` | Eaux | 0.50 |
| `poisson` | Poisson | 0.05 | | `vin` | Vins | 0.08 |
| `viande` | Viande & charcuterie | 0.15 | | `biere` | Bières, cidres & spiritueux | 0.10 |
| `laitier` | Produits laitiers & œufs | 0.35 | | `cafe` | Café & thé | 0.07 |
| `pain` | Pain & viennoiseries | 0.30 | | `condiments` | Condiments, sauces & huiles | 0.03 |
| `apero` | Apéritifs & snacks salés | 0.08 | | `bebe` | Bébé | 0.30 |
| `epicerie_sucree` | Épicerie sucrée | 0.05 | | `animaux` | Animaux | 0.10 |
| `chocolat` | Chocolat & confiserie | 0.08 | | `entretien` | Entretien & nettoyage | 0.03 |
| `petit_dej` | Petit-déjeuner & tartinables | 0.06 | | `hygiene` | Hygiène & beauté | 0.03 |
| `conserves` | Conserves | 0.08 | | `papier` | Papier & jetables | 0.10 |
| `surgeles` | Surgelés | 0.08 | | `pharmacie` | Pharmacie & compléments | 0.02 |
| `plats` | Plats préparés & soupes | 0.10 | | `autre` | Autre | 0.10 |

### 5.14 French wording of dates

All formatting uses `Intl` with locale `fr-FR` and time zone `Europe/Paris`, and the catalogue typography of design
`03` §0 (narrow no-break space U+202F between a number and its unit and after «≈»).

**Badge** (`formatRunOut(f, now, 'badge')`), identical to design `03` §3.4:

| Condition | Text |
|---|---|
| Total 0 | «Épuisé» |
| Usable forecast, days left < 1 | «< 1 j» |
| Usable forecast, 1 ≤ days left < 14 | «≈ {d} j», `d = max(1, round(daysLeft))` |
| Usable forecast, 14 ≤ days left < 60 | «≈ {w} sem.», `w = round(daysLeft / 7)` |
| Running low by threshold without a usable forecast | «Seuil» |
| Otherwise | no badge (null) |

**Detail** (`formatRunOut(f, now, 'detail')`, product detail screen):

- Total 0: «Stock épuisé».
- No usable forecast: «Pas assez d’historique pour estimer une date.»
- Days left ≥ 60: «Fin du stock estimée : dans plus de 2 mois».
- Otherwise: «Fin du stock estimée : {day}», where `{day}` is «aujourd’hui», «demain», or
  «{weekday} {d} {month}» (`{ weekday: 'long', day: 'numeric', month: 'short' }`, for example «samedi 16 nov.»),
  followed on a second line by «Entre le {d1} et le {d2} · {confidence}», dates as `{ day: 'numeric',
  month: 'short' }` and confidence «estimation fiable» (high) or «estimation approximative» (medium). When both band
  ends fall on the same day the second line is only the confidence.

**Next trip** (`formatNextTrip(trip, now)`): null without a cadence; otherwise «Prochaines courses : {day}» with
`{day}` as above, prefixed by «vers » when the cadence confidence is `low` («Prochaines courses : vers samedi
16 nov.»).

**Courses reason line**: `out` «Épuisé», `threshold` «Sous le seuil d’alerte», `forecast` «Bientôt épuisé»,
`before-next-trip` «Fin du stock avant les prochaines courses».

### 5.15 When it runs and memoisation

The forecast is recomputed after each applied pull and after each optimistic change, through store selectors:

- `forecastProduct` is memoised per product on the key (product row `updatedAt`, number and last `seq` of its
  movements, number of its pending movements, category key, household-has-cadence flag, Paris day of `now`). An
  optimistic withdrawal therefore recomputes one product only.
- `shoppingCadence` is memoised on (number and last `seq` of restock movements, pending restocks, Paris day).
- `nextTrip`, `runningLowView` and `shoppingList` are recomputed from the memoised parts; they are linear in the
  number of products.
- A visible-only timer re-evaluates at the next Paris midnight so "today" and `asOf` roll over.

Expected cost: a full recomputation of 300 products and 5 000 movements in under 50 ms on the target phones, and
under 2 ms for one product (checked in §6.1).

---

## 6. Testing

### 6.1 Forecasting module unit tests (Vitest)

Tests run on synthetic ledgers from a seeded generator (`tests/forecast/generator.ts`, PRNG mulberry32, fixed seeds)
that produces movements with `seq`, `created_at`, `client_at`, `quantity_after` per pantry, plus the ground-truth
run-out times. `now` is always injected.

| # | Scenario | Pass criterion |
|---|---|---|
| 1 | No history (product created, never stocked) | Rate = category prior; confidence `low`; `daysLeft` null; not running low. |
| 2 | Steady use, 1 unit every 2 days for 120 days, weekly restocks to 6 | Rate within ±15 % of 0.5 at day 120; confidence `high`; median run-out error under 2 days over 50 seeds. |
| 3 | Stock-out censoring: same true rate, product at 0 half of the time | Rate within ±20 % of the true in-stock rate; error smaller than a 30-day moving average's on the same ledger. |
| 4 | Abandoned product: use stops at day 30 | At day 90 the rate is under 25 % of the day-30 rate. |
| 5 | Bulk withdrawal of 24 with usual quantity 6 | Contribution to Q equals 6 · w, not 24 · w. |
| 6 | Non-demand kinds: discard, recount, transfer out/in, correction | Q unchanged by them; a transfer between two live pantries leaves the total and the exposure unchanged. |
| 7 | Reverted consume (correction with `reverts_id`) | The reverted consume is not a demand event. |
| 8 | Two pantries | Reconstructed total equals the sum; exposure counts time when either pantry holds stock. |
| 9 | Truncated ledger (first known movement: `quantity_after` 5, delta −1) | `initialTotal` = 6; series identical to the full-ledger series after that point. |
| 10 | Deleted pantry | Its movements are ignored; the total matches the cache. |
| 11 | Offline client times: consumes with `client_at` 3 days before `created_at`, one 10 days before | Times used are `client_at` for the first, `created_at − 7 days` for the second; series is non-decreasing. |
| 12 | Threshold hysteresis: total 6 → 1 one by one, then 2, then 3 (usual 6) | `m = 2`, `c = 3`; exactly one transition to low (at 2); still low at 2 after 1; cleared at 3. The same table of cases is used by the SQL test of the trigger, and both must agree. |
| 13 | `lowAlert` false; `minQuantity` 0; deleted product | Never low; low only at 0; not low. |
| 14 | Forecast rule | Low by forecast at 4.0 days left with ≥ 3 events; not with 2 events. |
| 15 | `asOf` stability | Same median run-out for two `now` values in the same Paris day with no new movement; `daysLeft` decreases. |
| 16 | Usual quantity | Median of the last 5 post-restock levels; sessions within 6 h merged; null with no stock ever. |
| 17 | Cadence | Sessions every 7 days ± 1 → median gap within 7 ± 0.5, weekday = generator's; 2 restocks 3 h apart merged; fewer than 3 sessions → null; IQR rule gives the expected confidence. |
| 18 | Next trip | Three products running out in 2 days pull `tripAt` to the 3rd run-out; `tripAt ≥ now`; no cadence → `tripOn` null. |
| 19 | Courses | Membership, quantity (`usual − total`, at least 1, `c` when usual is null), order by urgency, `lowAlert` false excluded. |
| 20 | Dismissals | Hidden while no restock; a server or pending restock clears it; scopes independent. |
| 21 | Band calibration | Over 200 simulated products with gamma inter-arrival times, 70 % to 90 % of true run-outs fall inside the 80 % band. |
| 22 | Material change | Table-driven cases for every rule in §5.9, including the 7-day heartbeat. |
| 23 | Wording | Table of `formatRunOut` and `formatNextTrip` outputs, including the daylight-saving days (last Sunday of March and October) and the U+202F / U+00A0 characters. |
| 24 | Purity | Same inputs give deep-equal outputs; the module never calls `Date.now`. |
| 25 | Performance | 300 products × 5 000 movements full run under 50 ms in CI (Node), one product under 2 ms. |
| 26 | Sensitivity report (not a gate) | Half-life {14, 30, 60}, k {7, 14, 30}, window {60, 90, 180}, cap {1×, 2×}: run-out error printed for calibration. |

### 6.2 Edge Function tests (Deno test)

The function's logic is split from its I/O: `run(deps)` takes a `NotificationStore` (claim, complete), a `send`
function, a clock and a logger. Tests use:

- a **fake store** returning scripted claim results and recording complete reports;
- a **fake push service**: a local `Deno.serve` on a random port whose URL is used as the subscription endpoint. Each
  test subscription has a real P-256 key pair and auth secret generated in the test, so the fake service **decrypts**
  the aes128gcm body and asserts the JSON payload, and also checks the `TTL`, `Urgency`, `Topic` and VAPID
  `Authorization` headers. Responses are scripted per endpoint (201, 404, 410, 403, 413, 429, 500, delay).

Cases and pass criteria:

1. Missing or wrong `x-cellier-secret` → 401; right secret → 202 before any claim completes.
2. Single running-low item → one message, title «Pâtes : plus que 1», body and tag as §3.6, `navigate` absolute,
   payload valid against `PushPayload` (`web_push` 8030, title and navigate non-empty), size under 3 000 bytes.
3. Three items, same household, same recipient → one message «3 articles à racheter», name list, path `/groceries`.
4. Item restocked during the debounce (`totalQuantity > minQuantity`) → `skipped`, `no_longer_low`; product null →
   `product_gone`; no recipient → `no_recipient`.
5. 410 and 404 → subscription `gone`; item `skipped` `all_gone` when every subscription is gone.
6. 500 or timeout only → subscription `error`; item omitted from the report.
7. 403 → subscription omitted; item `failed` `sender_fault_403`; error logged.
8. One subscription receiving a group and a digest, one gone → reported once as `gone`.
9. Digest copy for trip tomorrow, today and none; `empty_digest` skip; stale `runOutAt` filtered; TTL 14 400.
10. Topic is 32 base64url characters and identical for identical tags.
11. Claim returning 50 items repeatedly → loop stops at 60 s (fake clock) or 300 requests; concurrency never above 6.
12. Logs contain no endpoint path, key, product name or household name.
13. CPU: measure average CPU per push with `performance.now()` around encryption; fail if above 5 ms on CI.

A smoke test against a local Supabase (`supabase functions serve` with `policy = "per_worker"` so
`EdgeRuntime.waitUntil` work survives) checks the real RPCs end to end with a seeded household.

### 6.3 Real-device checklist for iOS push

Devices: one iPhone on iOS 16.4–18.3 (classic path) and one on iOS 18.4 or later, ideally also iOS 26; production
Vercel URL; Web Inspector connected for the service worker console. Record for each run: device, iOS version, time
sent, notification shown (yes/no), subscription still present (yes/no).

1. Safari tab: no permission prompt anywhere; Notifications page shows the install guide.
2. Install with «Sur l’écran d’accueil» (on iOS 26 with «Ouvrir comme app web» on); first session shows no card.
3. Second session: the card appears at its trigger; «Activer les alertes» shows the iOS prompt; allow; a row appears
   in `push_subscriptions` with the device's user agent.
4. Refuse on a second device: the denied explanation is shown; no prompt again.
5. Withdraw a product to its minimum from **another member's** device: one notification within about 90 seconds on the
   first device, none on the acting device.
6. Withdraw three products within 20 seconds: one grouped notification.
7. Tap a single alert with the app closed: product detail opens; with the app open in the background on another
   screen: the app comes forward and navigates.
8. Tap a grouped alert and a digest: Courses opens.
9. Repeat step 5 for the same product after a partial restock below the clear level: no new alert. Restock above it,
   deplete again: one new alert, replacing the old one if still in Notification Centre (tag check).
10. Digest: set the device's household to qualify, wait for 18:00 Paris (or trigger the function in a test project),
    one digest per member with the preference on; none with it off.
11. Phone in airplane mode for 2 hours, then back: a pending alert is delivered (TTL 12 h); a digest older than 4 hours
    is not.
12. Send 10 notifications in a day: the subscription survives (`getSubscription()` unchanged at next start), proving no
    push went without a notification.
13. Classic path device: kill the app, send a push: the notification shows (service worker handler).
14. Badge: equals the Accueil list length after a sync; cleared when the list is empty.
15. Sign out: the row disappears; a push sent to the old endpoint returns 404 or 410 in the function log.
16. Delete the app from the Home Screen, send a push: the row is deleted by the next run (or note if Apple returns
    2xx). Reinstall: the prompt is shown again from a tap and a new row is created.
17. Focus mode on: note whether the notification is delayed or summarised.
18. Toggle each preference switch offline (disabled) and online (applied on the other device after sync).

---

## 7. Verification record

Research items marked UNVERIFIED that this design depends on were handled as follows (sources fetched on
2026-11-10).

**Verified against primary sources.**

- Declarative Web Push format: WebKit's "Meet Declarative Web Push" post (title and navigate required, the message is
  the fallback if a service worker shows nothing) and the W3C Push API editor's draft (parse algorithm: `web_push`
  must equal 8030; `notification.title` and `notification.navigate` required; optional `tag`, `body`, `lang`, `dir`,
  `silent`, `data`; `mutable` is a top-level member defaulting to false; immutable messages are shown without the
  service worker; `PushEvent.notification`). Neither source defines `app_badge` the same way, hence §2.5.
- Apple's "Sending web push notifications in web apps and browsers" (developer.apple.com JSON): invisible pushes
  lead to permission revocation; `TTL`, `Urgency` (`very-low` to `high`) and `Topic` (32 base64url characters)
  supported; 410 means expired token, 404 `BadPath`, 413 payload over 4 KB, 429 too many requests, `BadJwtToken`
  for a bad VAPID subject or key.
- RFC 8030: Topic restrictions, Urgency values, TTL may be shortened, 404 for an expired subscription, 4 096 bytes
  as the minimum payload a service must accept.
- npm registry: `@pushforge/builder` latest is 2.0.5 (research 12 said 2.0.4); its README documents
  `message.options` nesting, object payloads, JWK private key as object or string, ttl maximum 86 400, Deno support.
  `@supabase/supabase-js` latest is 2.119.0.
- Supabase docs: Edge Function limits (150 s wall clock on free, 2 s CPU, 256 MB); injected secrets
  (`SUPABASE_SECRET_KEYS` JSON with a `default` key, legacy `SUPABASE_SERVICE_ROLE_KEY`); background tasks with
  `EdgeRuntime.waitUntil` and the `beforeunload` shutdown event; pg_net `http_post` default timeout 2 000 ms and
  6-hour response retention.

**Designed so that it does not matter.**

- `pushsubscriptionchange` on iOS: reconciliation at every start (§1.5).
- Whether `tag` replacement works on iOS: the service worker never shows a second copy of a declarative message, and
  retries are rare.
- `WindowClient.navigate()` on iOS: not used; `postMessage` to the page instead.
- Badging API from the service worker and the declarative `app_badge` placement: the page sets the badge.
- `subscribe()` without a gesture when permission is already granted: attempted, with a tap-driven fallback.
- Reliability of `display-mode: standalone` on iOS 26: never used as the only gate.
- pg_net timeout versus function duration: the function answers 202 immediately.
- Whether pushforge encrypts with aes128gcm: asserted by the fake push service decrypting in tests (§6.2).
- Focus and notification summary behaviour: no copy promises immediate delivery; checked on device (§6.3).
