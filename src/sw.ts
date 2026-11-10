/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import {
  cellierData,
  notificationFromPush,
  notificationTargetPath,
  type SwNavigateMessage,
  urlBase64ToUint8Array,
} from './features/notifications/model/payload';
import { strictSubscriptionJSON, writePendingSubscriptionChange } from './features/notifications/model/pendingChange';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html')));

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});

// --- Push (04-notifications-forecasting.md §1.7, §2) ----------------------------------------------

declare global {
  interface ImportMetaEnv {
    readonly VITE_VAPID_PUBLIC_KEY?: string;
  }
  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

/** Not in the TypeScript WebWorker lib. */
interface PushSubscriptionChangeEvent extends ExtendableEvent {
  readonly newSubscription: PushSubscription | null;
  readonly oldSubscription: PushSubscription | null;
}

// Every push must show a notification (iOS revokes push otherwise). Nothing is awaited before
// showNotification except the synchronous parse.
self.addEventListener('push', (event) => {
  // iOS 18.4+: a declarative message whose notification the system shows itself.
  if ((event as PushEvent & { notification?: Notification }).notification) return;
  let payload: unknown = null;
  try {
    payload = event.data?.json() ?? null;
  } catch {
    payload = null;
  }
  const { title, options } = notificationFromPush(payload);
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const notification = event.notification as Notification & { navigate?: string };
  const path = notificationTargetPath(notification.data, notification.navigate, self.location.origin);
  const message: SwNavigateMessage = { type: 'cellier:navigate', path, data: cellierData(notification.data) };
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (existing) {
        await existing.focus();
        existing.postMessage(message);
        return;
      }
      await self.clients.openWindow(path);
    })(),
  );
});

// Not fired on iOS (WebKit bug 273063); handled for other browsers. The worker has no Supabase
// session, so it only records the change; the page saves it at the next start (reconcilePush).
self.addEventListener('pushsubscriptionchange', (event) => {
  const e = event as PushSubscriptionChangeEvent;
  e.waitUntil(
    (async () => {
      let next = e.newSubscription;
      const key = import.meta.env.VITE_VAPID_PUBLIC_KEY;
      if (!next && e.oldSubscription && key) {
        try {
          next = await self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(key),
          });
        } catch {
          next = null;
        }
      }
      await writePendingSubscriptionChange({
        at: new Date().toISOString(),
        oldEndpoint: e.oldSubscription?.endpoint ?? null,
        newSubscription: next ? strictSubscriptionJSON(next.toJSON()) : null,
      }).catch(() => undefined);
    })(),
  );
});
