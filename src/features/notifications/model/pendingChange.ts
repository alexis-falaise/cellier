/**
 * §1.7. Record written by the service worker on `pushsubscriptionchange` (it has no Supabase
 * session) and read once by the page at the next start. IndexedDB database `cellier-sw`, store
 * `push`, key `change`. Shared by the worker and the page: no `@/` imports, no DOM-only types.
 */

/** `PushSubscription.toJSON()` with the fields Cellier relies on made non-optional. */
export interface PushSubscriptionJSONStrict {
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
}

export interface PendingSubscriptionChange {
  at: string;
  oldEndpoint: string | null;
  newSubscription: PushSubscriptionJSONStrict | null;
}

const DB = 'cellier-sw';
const STORE = 'push';
const KEY = 'change';

function open(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(factory: IDBFactory, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>) {
  return open(factory).then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(req.result);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      }),
  );
}

/** Validates `PushSubscription.toJSON()`; null when a key is missing. */
export function strictSubscriptionJSON(json: {
  endpoint?: string;
  expirationTime?: number | null;
  keys?: Record<string, string>;
}): PushSubscriptionJSONStrict | null {
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) return null;
  return { endpoint: json.endpoint, expirationTime: json.expirationTime ?? null, keys: { p256dh, auth } };
}

export function writePendingSubscriptionChange(
  change: PendingSubscriptionChange,
  factory: IDBFactory = indexedDB,
): Promise<void> {
  return run(factory, 'readwrite', (s) => s.put(change, KEY)).then(() => undefined);
}

/** Reads and deletes the pending record. Resolves null when there is none or IndexedDB fails. */
export async function takePendingSubscriptionChange(
  factory: IDBFactory | undefined = globalThis.indexedDB,
): Promise<PendingSubscriptionChange | null> {
  if (!factory) return null;
  try {
    const value = await run<unknown>(factory, 'readonly', (s) => s.get(KEY));
    if (value === undefined) return null;
    await run(factory, 'readwrite', (s) => s.delete(KEY));
    return value as PendingSubscriptionChange;
  } catch {
    return null;
  }
}
