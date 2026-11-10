/** Page-side helpers for §2.4 (navigation after a notification tap) and §2.5 (app badge). */
import { cellierData, isNotificationPath, type SwNavigateMessage } from './payload';

/**
 * Calls `onNavigate` for every `cellier:navigate` message posted by the service worker after a
 * notification tap. Returns the unsubscribe function. The router decides when to navigate
 * (design 03 §1.6: after an open scanner or an unsaved sheet).
 */
export function listenForNotificationNavigation(onNavigate: (message: SwNavigateMessage) => void): () => void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return () => {};
  const handler = (event: MessageEvent) => {
    const msg = event.data as { type?: unknown; path?: unknown; data?: unknown } | null;
    if (msg?.type !== 'cellier:navigate' || !isNotificationPath(msg.path)) return;
    onNavigate({ type: 'cellier:navigate', path: msg.path, data: cellierData(msg.data) });
  };
  navigator.serviceWorker.addEventListener('message', handler);
  return () => navigator.serviceWorker.removeEventListener('message', handler);
}

/** §2.5. App icon badge = number of running-low products on Accueil (before the cellier filter). */
export async function updateAppBadge(count: number): Promise<void> {
  if (typeof navigator === 'undefined' || !('setAppBadge' in navigator)) return;
  try {
    if (count > 0) await navigator.setAppBadge(count);
    else await navigator.clearAppBadge();
  } catch {
    // Badging is best effort.
  }
}
