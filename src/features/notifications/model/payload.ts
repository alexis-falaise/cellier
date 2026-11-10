/**
 * Push payload handling shared by the service worker (src/sw.ts) and the page. Compiled under both
 * the DOM and the WebWorker libs: relative imports only, no `@/` alias, no DOM-only types.
 * Contract: docs/architecture/contracts/notifications.ts §1–2; 04-notifications-forecasting.md §2.
 */

/** App routes a notification can open (§2.4). */
export type NotificationPath = '/' | '/groceries' | `/items/${string}`;

export type NotificationKind = 'running_low' | 'digest';

/** Data carried by every notification (contract `CellierNotificationData`). */
export interface CellierNotificationData {
  v: 1;
  kind: NotificationKind;
  householdId: string;
  productIds: string[];
  path: NotificationPath;
  outboxIds: number[];
  sentAt: string;
}

/** The `notification` member of a declarative Web Push message (§2.1). */
export interface DeclarativeNotification {
  title: string;
  body: string;
  navigate: string;
  tag: string;
  lang: 'fr';
  dir: 'ltr';
  silent: false;
  data: CellierNotificationData;
}

/** The JSON object encrypted into every push message. */
export interface PushPayload {
  web_push: 8030;
  notification: DeclarativeNotification;
}

/** Posted by the service worker to an open window after a notification tap (§2.4). */
export interface SwNavigateMessage {
  type: 'cellier:navigate';
  path: NotificationPath;
  data: CellierNotificationData | null;
}

/**
 * Shown when a push cannot be parsed (§2.2): iOS revokes push for a site whose pushes show nothing.
 * Strings: fr.ts has no keys for these yet (`push.fallback.title`, `push.fallback.body` requested);
 * the service worker does not load the string catalogue.
 */
export const NOTIFICATION_FALLBACK = {
  title: 'Cellier',
  body: 'Du nouveau dans votre cellier.',
  tag: 'cellier',
  path: '/' as NotificationPath,
} as const;

export interface NotificationToShow {
  title: string;
  options: NotificationOptions;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/**
 * §2.2. Turns the parsed push body into `showNotification` arguments. Every input gives a
 * notification: a malformed payload gives the fallback.
 */
export function notificationFromPush(payload: unknown): NotificationToShow {
  const n = isRecord(payload) && payload.web_push === 8030 ? payload.notification : null;
  if (!isRecord(n) || typeof n.title !== 'string' || n.title.trim() === '') {
    return {
      title: NOTIFICATION_FALLBACK.title,
      options: {
        body: NOTIFICATION_FALLBACK.body,
        tag: NOTIFICATION_FALLBACK.tag,
        lang: 'fr',
        dir: 'ltr',
        silent: false,
        data: { path: NOTIFICATION_FALLBACK.path },
      },
    };
  }
  const options: NotificationOptions = {
    body: typeof n.body === 'string' ? n.body : '',
    lang: 'fr',
    dir: 'ltr',
    silent: false,
    data: isRecord(n.data) ? { ...n.data, navigate: n.navigate } : { navigate: n.navigate },
  };
  if (typeof n.tag === 'string' && n.tag !== '') options.tag = n.tag;
  return { title: n.title, options };
}

const SAFE_PATH = /^\/$|^\/groceries$|^\/items\/[0-9a-f-]{36}$/;

/** True for one of the routes a notification may open (§2.4). */
export function isNotificationPath(path: unknown): path is NotificationPath {
  return typeof path === 'string' && SAFE_PATH.test(path);
}

/**
 * §2.4 step 2: `data.path`, else the path of `navigate` (same origin only), accepted only if it is
 * a known route; otherwise '/'.
 */
export function notificationTargetPath(data: unknown, navigate: unknown, origin: string): NotificationPath {
  if (isRecord(data) && typeof data.path === 'string') {
    return isNotificationPath(data.path) ? data.path : '/';
  }
  const raw = typeof navigate === 'string' ? navigate : isRecord(data) ? data.navigate : undefined;
  if (typeof raw === 'string') {
    try {
      const url = new URL(raw, origin);
      if (url.origin === origin && isNotificationPath(url.pathname)) return url.pathname;
    } catch {
      // not a URL
    }
  }
  return '/';
}

/** The `data` member as `CellierNotificationData` when it has that shape, else null. */
export function cellierData(data: unknown): CellierNotificationData | null {
  return isRecord(data) && data.v === 1 && typeof data.kind === 'string' && isNotificationPath(data.path)
    ? (data as unknown as CellierNotificationData)
    : null;
}

/** base64url (VAPID public key) → bytes for `applicationServerKey`. */
export function urlBase64ToUint8Array(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = base64url
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(base64url.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
