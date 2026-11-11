import { useRegisterSW } from 'virtual:pwa-register/react';

/** Periodic check while the app stays in the foreground. */
const CHECK_INTERVAL_MS = 15 * 60 * 1000;

/**
 * The browser only looks for a new service worker on a navigation. A home-screen app resumed from the
 * background never navigates, so it would keep the old build (and never offer the update) until it is
 * killed. Check again whenever the app comes back to the foreground, and periodically while it stays open.
 * Each check is one revalidated request for sw.js (served no-store).
 */
function watchForUpdates(registration: ServiceWorkerRegistration) {
  const check = () => {
    if (document.visibilityState !== 'visible' || navigator.onLine === false || registration.installing) return;
    registration.update().catch(() => {
      // Offline or server hiccup: the next foreground or tick retries.
    });
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
  setInterval(check, CHECK_INTERVAL_MS);
}

export function useServiceWorker() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (registration) watchForUpdates(registration);
    },
  });
  return { needRefresh, applyUpdate: () => updateServiceWorker(true) };
}
