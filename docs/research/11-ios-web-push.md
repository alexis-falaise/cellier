# iOS Web Push for Home-Screen Web Apps (Cellier)

Research date: 2026-11-10. Target: iPhone 13 to 15 Pro, iOS 16.4+ (Cellier's floor; recommend iOS 18.4+ for Declarative Web Push).

Legend: **VERIFIED** = read from a fetched primary or secondary source in this session. **UNVERIFIED** = from memory, forum/anecdote, or a source I could not open. Treat every UNVERIFIED item as a thing to test on a real device before relying on it.

Note on sources: the Apple Developer page "Sending web push notifications in web apps and browsers" (`developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers`) returned only its title, not its body. MDN's Notification page returned without its compatibility table. Anything that depended on those pages is marked UNVERIFIED.

---

## 1. Requirements

| Requirement | Status | Source |
|---|---|---|
| iOS / iPadOS 16.4+ for Web Push in Home Screen web apps | VERIFIED (Feb 2023 launch, iOS 16.4 beta 1) | [WebKit blog, "Web Push for Web Apps on iOS and iPadOS", 2023-02-16](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/) |
| App must be added to Home Screen. Push does not work in a regular Safari tab on iOS | VERIFIED | same |
| Manifest `display` set to `standalone` or `fullscreen` (this is what makes the site a Home Screen web app) | VERIFIED | same |
| Permission prompt must come from a direct user gesture (e.g. tap on a "Enable notifications" button). Calling `Notification.requestPermission()` on page load fails | VERIFIED | same, quoted: "in response to direct user interaction, such as tapping on a 'subscribe' button" |
| No Apple Developer Program membership needed | VERIFIED | same |
| Declarative Web Push on iOS/iPadOS | VERIFIED: available in 18.4 for Home Screen web apps | [WebKit, "Meet Declarative Web Push"](https://webkit.org/blog/16535/meet-declarative-web-push/); [WebKit Features in Safari 18.4](https://webkit.org/?p=16574) |
| Declarative Web Push on macOS | VERIFIED: arrived with Safari 18.5 / macOS 15.5, not 18.4 | [MacTech, 2025-05-12](https://www.mactech.com/2025/05/12/with-safari-18-5-included-in-macos-15-5-apple-added-declarative-web-push) |

Feature detection, not browser sniffing, is the recommendation in WebKit's post.

---

## 2. Installed-state detection and onboarding

Only a Home Screen app can receive push on iOS. Detect this and show an "Add to Home Screen" guide before offering the subscribe button.

```ts
// src/push/installState.ts
export function isStandalone(): boolean {
  // Standard display-mode query (iOS 16.4+ home-screen apps report "standalone").
  const mq = window.matchMedia?.('(display-mode: standalone)').matches ?? false;
  // Legacy iOS Safari flag. Still present; cast because lib.dom types it as non-standard.
  const legacy = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return mq || legacy;
}

export function isIOS(): boolean {
  const ua = navigator.userAgent;
  // iPadOS 13+ reports as Mac; detect via touch points.
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function pushSupportedHere(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}
```

Onboarding logic:

1. `isIOS() && !isStandalone()` → show the "Add to Home Screen" instructions (Share → Add to Home Screen) and do **not** call `requestPermission`. Not installed means no push, and no permission prompt.
2. `isStandalone()` and `Notification.permission === 'default'` → show an in-app "Enable notifications" button; call `requestPermission` from its click handler.
3. `Notification.permission === 'denied'` → explain how to re-enable in iOS Settings → Notifications → Cellier. The browser will not prompt again.

**UNVERIFIED**: whether `display-mode: standalone` is reliable in every iOS version Cellier supports. The `navigator.standalone` fallback covers older Safari.

---

## 3. Client subscribe flow

Key facts:
- `userVisibleOnly: true` is mandatory on iOS. WebKit's declarative post states: "WebKit requires you as the developer to always show a notification; no silent push messages are allowed" ([WebKit, Meet Declarative Web Push](https://webkit.org/blog/16535/meet-declarative-web-push/)). VERIFIED.
- `applicationServerKey` is the VAPID public key as a `Uint8Array` (base64url-decoded).
- The subscription can be created from the window with `window.pushManager.subscribe(...)`; WebKit states a service worker is not required for that ([WebKit](https://webkit.org/blog/16535/meet-declarative-web-push/)). VERIFIED. The service worker is still needed for the classic `push` event path (see §4).

```ts
// src/push/subscribe.ts
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string;

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export type SubscribeResult =
  | { ok: true; subscription: PushSubscription }
  | { ok: false; reason: 'not-installed' | 'denied' | 'unsupported' | 'error'; error?: unknown };

// MUST be called synchronously from a click/tap handler.
// Do not await anything before requestPermission(); Safari may reject the gesture.
export async function enablePush(): Promise<SubscribeResult> {
  if (!pushSupportedHere()) return { ok: false, reason: 'unsupported' };
  if (isIOS() && !isStandalone()) return { ok: false, reason: 'not-installed' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: 'denied' };

  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;

    const existing = await reg.pushManager.getSubscription();
    const subscription =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      }));

    await saveSubscription(subscription); // POST endpoint + keys to Supabase
    return { ok: true, subscription };
  } catch (error) {
    return { ok: false, reason: 'error', error };
  }
}

async function saveSubscription(sub: PushSubscription): Promise<void> {
  const json = sub.toJSON(); // { endpoint, expirationTime, keys: { p256dh, auth } }
  // Upsert keyed by endpoint so re-subscribing does not create duplicates.
  // Implementation depends on the Supabase table; left to the app.
  void json;
}
```

Notes:
- Call `enablePush()` from a `click` handler, not from `useEffect`.
- On every app launch, call `reg.pushManager.getSubscription()` and re-upsert if it returns `null` but `Notification.permission === 'granted'` (see §6).

---

## 4. Server-side send: endpoint, encryption, headers

| Topic | Finding | Status |
|---|---|---|
| Endpoint host | `web.push.apple.com` for Safari/iOS subscriptions | UNVERIFIED (widely observed in subscriptions; not confirmed on a fetched Apple page). Do not hard-code. Read `subscription.endpoint`. |
| Allowlist | WebKit says: if you control push endpoints, allow `*.push.apple.com` | VERIFIED ([WebKit 2023](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)) |
| Protocol | Standard Web Push: RFC 8030 (transport), RFC 8291 (message encryption, `aes128gcm`), RFC 8292 (VAPID) | UNVERIFIED for Apple specifics; standard protocol |
| Auth | VAPID JWT in `Authorization: vapid t=...,k=...` | UNVERIFIED (standard) |
| Headers `TTL`, `Urgency`, `Topic` | Standard RFC 8030 headers. Support on Apple's endpoint not confirmed | UNVERIFIED |
| Use `web-push` npm lib in an Edge Function | Handles RFC 8291 encryption and VAPID. Fits Supabase Edge Functions (Deno: use `npm:web-push` or the Deno-compatible equivalent) | UNVERIFIED (library choice) |

Recommended send headers (RFC standard values; verify on device):
- `TTL: 86400` (a household "running low" alert goes stale; 1 day is fine)
- `Urgency: normal` (`high` may wake the device sooner but is not needed)
- `Topic: <item-id>` (collapses repeated alerts for the same item while offline)

**Penalty for silent pushes**: Developers consistently report that Apple revokes a subscription after pushes that do not show a notification. One Discourse thread reports a threshold of three; an Apple forum thread and a WebKit bug (273063, "webPush subscription becomes invalid for few users") discuss lost subscriptions. The numeric threshold is **UNVERIFIED**; the behaviour is widely reported but not documented by Apple in anything I could open. Practical rule: every push must produce a visible notification, including on error paths.

Sources: [Discourse, "iOS notifications can lose permission…"](https://meta.discourse.org/t/ios-notifications-can-lose-permission-to-push-if-the-user-is-currently-active/290225); [Progressier, "how to fix iOS push subscriptions being terminated after 3 notifications"](https://dev.to/progressier/how-to-fix-ios-push-subscriptions-being-terminated-after-3-notifications-39a7); [WebKit Bugzilla 273063](https://bugs.webkit.org/show_bug.cgi?id=273063).

---

## 5. Service worker: `push` and `notificationclick`

Rules:
- Every `push` event must call `showNotification` **inside `event.waitUntil`**. Do any async work (fetch, Supabase) before showing, but keep it bounded. Do not gate display on `clients.matchAll` or focus state.
- Use a `tag` per item so a repeat push replaces, not stacks. **UNVERIFIED** whether replacement by `tag` is honoured on current iOS (one WebKit report says it was not on 16.4).
- `notificationclick`: focus an existing client if one is open, otherwise `openWindow`, and deep-link via `data.url`.

```ts
// src/sw.ts (vite-plugin-pwa injectManifest, or a hand-written /sw.js)
/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope;

interface CellierPushData {
  title?: string;
  body?: string;
  tag?: string;
  url?: string;
  app_badge?: string;
  web_push?: number;
  notification?: {
    title?: string;
    body?: string;
    tag?: string;
    navigate?: string;
    app_badge?: string;
    silent?: boolean;
  };
}

self.addEventListener('push', (event: PushEvent) => {
  // Must show a notification for every push. Never return without showing one.
  event.waitUntil(handlePush(event));
});

async function handlePush(event: PushEvent): Promise<void> {
  let data: CellierPushData = {};
  try {
    data = event.data?.json() as CellierPushData;
  } catch {
    data = { title: 'Cellier', body: event.data?.text() ?? 'Something is running low' };
  }

  // Accept both the classic flat shape and the declarative-compatible shape.
  const n = data.notification ?? data;
  const title = n.title || 'Cellier';
  const url = (n as { navigate?: string; url?: string }).navigate ?? (n as { url?: string }).url ?? '/';

  await self.registration.showNotification(title, {
    body: n.body,
    tag: n.tag,            // replace, do not stack, when the same item is re-sent
    data: { url },          // read back in notificationclick
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png', // iOS ignores on most versions; harmless
  });

  const badge = (n as { app_badge?: string }).app_badge ?? data.app_badge;
  if (badge !== undefined && 'setAppBadge' in navigator) {
    await navigator.setAppBadge(Number(badge)).catch(() => undefined);
  }
}

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url ?? '/', self.location.origin).href;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = windows.find((c) => c.url.startsWith(self.location.origin));
      if (existing) {
        await existing.focus();
        // Navigate the existing client to the deep link.
        if ('navigate' in existing) await (existing as WindowClient).navigate(target);
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});
```

Caveats:
- `WindowClient.navigate()` on iOS: **UNVERIFIED** on every version; if it throws, fall back to `openWindow`. Test on device.
- `navigator.setAppBadge` in a service worker: the Badging API is documented in WebKit's 16.4 post for Home Screen apps ([WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)). Calling from the SW context is **UNVERIFIED**; calling from the page is safer.

---

## 6. Declarative Web Push (Safari 18.4+ on iOS)

### JSON format (verbatim from WebKit)

```json
{
    "web_push": 8030,
    "notification": {
        "title": "Webkit.org — Meet Declarative Web Push",
        "lang": "en-US",
        "dir": "ltr",
        "body": "Send push notifications without JavaScript or service worker!",
        "navigate": "https://webkit.org/blog/16535/meet-declarative-web-push/",
        "silent": false,
        "app_badge": "1"
    }
}
```

Source: [WebKit, Meet Declarative Web Push](https://webkit.org/blog/16535/meet-declarative-web-push/). VERIFIED.

- `web_push: 8030` is the opt-in marker. Its meaning is a WebKit magic value; no further explanation was given. VERIFIED (the value itself).
- `notification.title` is required and must be non-empty. `navigate` is the URL opened on click. `app_badge` is optional and applies to Home Screen apps. VERIFIED.
- Other `NotificationOptions` members (`body`, `lang`, `dir`, `silent`) are usable. Behaviour of `silent` is constrained (see below).
- **Fallback**: "the declarative push message itself is used as a fallback in case the optional JavaScript processing step fails." If a service worker is present it receives the push event, and if it does not show a replacement in time, the declarative notification is shown. VERIFIED ([WebKit](https://webkit.org/blog/16535/meet-declarative-web-push/)).
- The `"silent": false` in the example is not a silent push. WebKit forbids silent pushes; `userVisibleOnly` must be true.

### Backwards-compatible payload (recommended for Cellier)

Send one payload that works for both paths:

```json
{
  "web_push": 8030,
  "notification": {
    "title": "Riz est presque épuisé",
    "body": "Il reste 1 sachet. Pensez à le racheter.",
    "navigate": "https://cellier.app/items/abc123",
    "tag": "item-abc123",
    "app_badge": "3"
  }
}
```

Why this shape:
- Declarative browsers (iOS 18.4+) read `web_push` and `notification` and need no service worker.
- Classic handlers (older iOS 16.4–18.3) get the same bytes as `event.data.json()`. The SW code in §5 reads `data.notification` first, so it behaves identically.
- Keep `tag` identical in both paths so a SW-replaced notification replaces, not duplicates.

**Caveat**: the SW `push` handler still runs on iOS 18.4+ when a SW is registered. If it shows a second notification with a different tag, the user sees two. Use the same `tag` so the SW replaces rather than stacks. No documented feature-detect for declarative support was found (**UNVERIFIED**); test on device before deciding whether to drop the SW `push` handler.

### Why this suits iOS
- No cold-start SW wake-up to show a notification, so the "silent push" failure mode (SW throws or is slow → no notification → subscription revoked) is much less likely.
- Source: WebKit's stated motivation is removing the service worker requirement ([WebKit](https://webkit.org/blog/16535/meet-declarative-web-push/)). VERIFIED. The reliability benefit is **UNVERIFIED** until measured.

---

## 7. Badging API

- `navigator.setAppBadge(n)` / `navigator.clearAppBadge()` are supported for Home Screen web apps from iOS 16.4. Badge changes work in the foreground or during push handling. The badge display follows the same notification permission as other apps (not granted = no visible badge). VERIFIED ([WebKit 2023](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)).
- Declarative equivalent: `app_badge` in the JSON. VERIFIED ([WebKit 2025](https://webkit.org/blog/16535/meet-declarative-web-push/)).
- Set the badge to the count of **items still low** in the household, not the number of unread notifications. Clear it when the list is opened.

---

## 8. Notification options: honoured vs ignored on iOS

Evidence is mostly 2023–2024 forum, OneSignal and WebKit bug reports. Current-iOS behaviour is **UNVERIFIED** for every row; test on iPhone 13–15 Pro with iOS 18.x / 26.x.

| Option | iOS (Home Screen app) | Status |
|---|---|---|
| `title` | Shown | VERIFIED (required by declarative) |
| `body` | Shown | VERIFIED |
| `lang`, `dir` | Accepted in declarative format | VERIFIED (WebKit example) |
| `navigate` (declarative) / `data.url` (classic) | Used for click target | VERIFIED (declarative); classic is app-controlled |
| `app_badge` | Sets icon badge | VERIFIED |
| `icon` | Reported supported (OneSignal table, 16.4+) | UNVERIFIED for current iOS |
| `tag` | Reported **not** replacing on 16.4 (WebKit report) | UNVERIFIED current |
| `silent` | Not a silent push. Sound behaviour: one 16.4 report of no sound; no "Sounds" toggle for web apps | UNVERIFIED |
| `badge` (image) | Android-oriented; iOS ignores | UNVERIFIED (treat as ignored) |
| `image` | Reported unsupported on 16.4 (OneSignal; WebKit bug says MDN lists it as working but it does not) | UNVERIFIED current |
| `actions` | Reported unsupported on 16.4 (only a "View" action appeared). `actions` is only valid for SW `showNotification` per MDN | UNVERIFIED current; assume ignored |
| `vibrate`, `requireInteraction`, `renotify`, `timestamp`, `data` | No evidence found | UNVERIFIED |

Source for actions/image: [OneSignal FAQ, Safari Web Push](https://documentation.onesignal.com/docs/faq-safari-web-push); [Apple Developer Forums 726793](https://developer.apple.com/forums/thread/726793); [WebKit Bugzilla 280161](https://bugs.webkit.org/show_bug.cgi?id=280161). MDN states `actions` is only supported for `ServiceWorkerRegistration.showNotification()` ([MDN, Notification](https://developer.mozilla.org/en-US/docs/Web/API/Notification/Notification)). VERIFIED for MDN text.

Recommendation: send only `title`, `body`, `tag`, `navigate`/`data.url`, `app_badge`. Do not rely on images or buttons.

---

## 9. Focus modes and notification summary

- Home Screen web apps integrate with Focus. Users can configure per-app delivery via Focus. Focus settings sync across devices where the same app is installed, keyed by the manifest `id` plus name. VERIFIED ([WebKit 2023](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)).
- Notification summary (scheduled delivery) may hold non-time-sensitive notifications. **UNVERIFIED** whether web push notifications are summarised or batched on iOS 18+. Test.
- Cellier can set `Urgency: high` for "running low now" alerts, but Focus can still defer. Do not promise immediate delivery in UI copy.
- Set a stable manifest `id` (e.g. `/?source=pwa`) so Focus settings persist across URL changes. VERIFIED (manifest `id` supported from 16.4, per WebKit).

---

## 10. Subscription lifetime, `pushsubscriptionchange`, and recovery

- **`pushsubscriptionchange` on iOS**: a WebKit bug (273063) notes the event is not supported on iOS, and a later mailing-list post says it is not supported on mobile at all. VERIFIED that the bug exists; current support is **UNVERIFIED**. Do not rely on it. Caniuse data I could read shows "not supported" for iOS 3.2–16.3 only ([caniuse](https://caniuse.com/mdn-api_serviceworkerglobalscope_pushsubscriptionchange_event)).
- **Lost subscriptions** (reported causes): silent pushes (§4); uninstalling and reinstalling the Home Screen app; clearing website data; iOS removing the SW under storage pressure (WebKit notes that after a SW is removed, a notification can still show but can no longer be modified — VERIFIED from WebKit 2025 post); the push service returning 410 for a dead endpoint.
- **Apple returns HTTP 200/201 for some dead subscriptions** in forum reports, so do not treat 200 as proof of delivery ([Apple Developer Forums 719990](https://developer.apple.com/forums/thread/719990)). UNVERIFIED generality.

Recovery pattern:
1. Edge Function: on 404/410 from the push service, mark the subscription `dead` and stop sending.
2. On every app launch (standalone), call `getSubscription()`. If `null` and `Notification.permission === 'granted'`, re-subscribe. Re-subscribing with `subscribe()` does not need a fresh gesture **when permission is already granted**; creating a new subscription after revocation may — **UNVERIFIED**. Safe approach: show a banner "Notifications are off. Tap to re-enable" and call `enablePush()` from its tap.
3. Re-upsert the new endpoint against the same user/device record.

---

## 11. Safari (browser tab) vs installed app

- Push on iOS requires the Home Screen app. Opening the site in a Safari tab cannot receive push; `pushManager` is absent or `subscribe` throws. VERIFIED ([WebKit 2023](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)).
- Declarative Web Push on iOS 18.4 is also Home Screen only per the 18.4 release notes ([WebKit Features in Safari 18.4](https://webkit.org/?p=16574); search summary). VERIFIED for iOS, UNVERIFIED wording on the official page.
- Consequence: Cellier's web app must show onboarding in Safari and gate the subscribe button on `isStandalone()`.

---

## 12. EU (DMA) history and status

- **Feb 2024**: Apple announced that Home Screen web apps would stop working in the EU with iOS 17.4, citing the DMA's alternative-browser-engine requirement. VERIFIED ([Engadget / TechCrunch coverage, Feb 2024](https://www.engadget.com/apple-explains-why-web-apps-will-no-longer-work-on-european-ios-devices-112527267.html)).
- **1 March 2024**: Apple reversed course. Its updated developer FAQ states it "will continue to offer the existing Home Screen web apps capability in the EU", but the apps must still be built on WebKit. VERIFIED ([iclarified, 2024-03-01 reversal article](https://www.iclarified.com/92933/apple-changes-stance-on-home-screen-web-apps-in-the-eu); [GSMArena](https://www.gsmarena.com/apple_backtracks_wont_remove_progressive_web_apps_in_the_eu_after_all-news-61836.php)).
- **Current status (Nov 2026)**: I found no source confirming a later removal. One search result titled "Apple is killing web apps in the EU" (developer-tech) had no readable body and its date could not be confirmed. Status: **UNVERIFIED for 2025–2026**. Re-check Apple's developer FAQ before the launch.
- Cellier is a French product for French households. Verify the EU status on a French-region iPhone (App Store region and iOS region setting can differ from device country).

---

## 13. Testing and debugging

- Test only on a real device. The Simulator does not reproduce Home Screen push.
- Install the app via Add to Home Screen (not from Safari tab), grant permission, then send a test push from the Edge Function.
- **Web Inspector for Home Screen apps**: on a Mac with Safari, enable Settings → Safari → Advanced → Web Inspector on the iPhone. Connect the device via USB, then in Mac Safari use Develop → [iPhone name] → select the Home Screen web app entry. The Home Screen app appears as its own target. VERIFIED that Web Inspector attaches to Home Screen web apps (widely documented, check on current iOS); the exact menu path is UNVERIFIED on iOS 26.
- Log in the SW: use `console.log` in `push`; view via Web Inspector → Service Worker target.
- Check `Notification.permission` and `pushManager.getSubscription()` in the console on each launch.
- Silent-push check: after 5+ test pushes, confirm the subscription still exists (`getSubscription()` not null, endpoint unchanged).
- Keep a log table: iOS version, device, push time, notification shown (Y/N), subscription alive (Y/N).

---

## 14. Gotchas that cause lost subscriptions (summary)

1. Subscribing or requesting permission without a user gesture.
2. A `push` handler that awaits something slow or throws before `showNotification`.
3. Sending "data-only" pushes intended for background sync. On iOS every push must show.
4. Sending to a stale endpoint (410) and not pruning it.
5. Relying on `pushsubscriptionchange` on iOS.
6. Calling `subscribe()` from a Safari tab instead of the installed app.
7. Re-creating the VAPID keypair (old subscriptions become unusable). Store the private key in a Supabase secret; never regenerate it.

---

## 15. Recommendation for Cellier

- Requirements gate: iOS 16.4+ and standalone display mode; onboarding shown before permission.
- Payload: the backwards-compatible JSON in §6 (`web_push: 8030` + `notification` with `title`, `body`, `navigate`, `tag`, `app_badge`).
- Service worker: §5 `push` and `notificationclick`; always show; same `tag` per item.
- Options used: `title`, `body`, `tag`, `navigate`/`data.url`, `app_badge`. Do not depend on `image`, `actions`, `vibrate`.
- Headers: `TTL: 86400`, `Urgency: normal`, `Topic: <item id>`.
- Prune on 404/410; re-subscribe on launch when permission is granted but no subscription exists.
- Verify all UNVERIFIED rows on a real iPhone 13–15 Pro before shipping.

---

## Source list

- [WebKit, Web Push for Web Apps on iOS and iPadOS (2023-02-16)](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
- [WebKit, Meet Declarative Web Push (2025)](https://webkit.org/blog/16535/meet-declarative-web-push/)
- [WebKit Features in Safari 18.4](https://webkit.org/?p=16574)
- [WebKit Features in Safari 18.5](https://webkit.org/?p=16923)
- [MacTech, Safari 18.5 Declarative Web Push (2025-05-12)](https://www.mactech.com/2025/05/12/with-safari-18-5-included-in-macos-15-5-apple-added-declarative-web-push)
- [MDN, Notification](https://developer.mozilla.org/en-US/docs/Web/API/Notification/Notification) (compat table not readable)
- [Apple Developer, Sending web push notifications in web apps and browsers](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers) (body not readable)
- [WebKit Bugzilla 273063](https://bugs.webkit.org/show_bug.cgi?id=273063)
- [WebKit Bugzilla 280161](https://bugs.webkit.org/show_bug.cgi?id=280161)
- [OneSignal FAQ, Safari Web Push](https://documentation.onesignal.com/docs/faq-safari-web-push)
- [Apple Developer Forums 726793 (actions)](https://developer.apple.com/forums/thread/726793)
- [Apple Developer Forums 719990 (200 on dead subs)](https://developer.apple.com/forums/thread/719990)
- [Discourse, iOS notifications lose permission](https://meta.discourse.org/t/ios-notifications-can-lose-permission-to-push-if-the-user-is-currently-active/290225)
- [Progressier, iOS subscriptions terminated after 3 notifications](https://dev.to/progressier/how-to-fix-ios-push-subscriptions-being-terminated-after-3-notifications-39a7)
- [iclarified, EU reversal (2024-03-01)](https://www.iclarified.com/92933/apple-changes-stance-on-home-screen-web-apps-in-the-eu)
- [GSMArena, Apple backtracks on EU PWAs](https://www.gsmarena.com/apple_backtracks_wont_remove_progressive_web_apps_in_the_eu_after_all-news-61836.php)
- [Engadget, Apple explains EU web app removal (Feb 2024)](https://www.engadget.com/apple-explains-why-web-apps-will-no-longer-work-on-european-ios-devices-112527267.html)
- [caniuse, pushsubscriptionchange](https://caniuse.com/mdn-api_serviceworkerglobalscope_pushsubscriptionchange_event)
