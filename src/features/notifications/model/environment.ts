/**
 * §1.2. Browser capabilities the push flow depends on, behind an interface so the logic can be
 * tested without a browser.
 */

export interface PushSubscriptionLike {
  readonly endpoint: string;
  toJSON(): { endpoint?: string; expirationTime?: number | null; keys?: Record<string, string> };
  unsubscribe(): Promise<boolean>;
}

export interface PushManagerLike {
  getSubscription(): Promise<PushSubscriptionLike | null>;
  subscribe(options: { userVisibleOnly: true; applicationServerKey: BufferSource }): Promise<PushSubscriptionLike>;
}

export interface PushEnvironment {
  /** iPhone, iPad or iPod, including iPadOS reporting itself as a Mac. */
  isIOS: boolean;
  /** Running as an installed Home Screen web app. */
  isStandalone: boolean;
  /** Service worker, PushManager and Notification all exist. */
  pushSupported: boolean;
  userAgent: string;
  permission(): NotificationPermission;
  /** Must be the first awaited call of a tap handler (WebKit user-gesture rule). */
  requestPermission(): Promise<NotificationPermission>;
  /** `navigator.serviceWorker.ready`. */
  pushManager(): Promise<PushManagerLike>;
}

export function detectIOS(userAgent: string, platform: string, maxTouchPoints: number): boolean {
  return /iPhone|iPad|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
}

/** The real environment. Safe to call during SSR or tests: everything reports unsupported. */
export function browserPushEnvironment(): PushEnvironment {
  const hasWindow = typeof window !== 'undefined' && typeof navigator !== 'undefined';
  const nav = hasWindow ? (navigator as Navigator & { standalone?: boolean }) : undefined;
  const isStandalone =
    hasWindow &&
    ((typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) ||
      nav?.standalone === true);
  const pushSupported =
    hasWindow && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  return {
    isIOS: nav ? detectIOS(nav.userAgent, nav.platform, nav.maxTouchPoints) : false,
    isStandalone,
    pushSupported,
    userAgent: nav?.userAgent ?? '',
    permission: () => (pushSupported ? Notification.permission : 'default'),
    requestPermission: () => Notification.requestPermission(),
    pushManager: async () => (await navigator.serviceWorker.ready).pushManager as unknown as PushManagerLike,
  };
}
