/**
 * Web Push client (04-notifications-forecasting.md §1): status, enable from a tap, registration
 * through `register_push_subscription`, per-device switches, unsubscribe and start-up reconciliation.
 * Every dependency is injected; nothing here imports the Supabase singleton.
 */
import type { IsoDateTime, UserId } from '@/domain/types';
import type { PushEnvironment, PushSubscriptionLike } from './environment';
import { urlBase64ToUint8Array } from './payload';
import { type PendingSubscriptionChange, strictSubscriptionJSON, takePendingSubscriptionChange } from './pendingChange';

// ---------------------------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------------------------

interface ResultLike {
  data: unknown;
  error: { message: string; code?: string } | null;
}

/** Subset of the Supabase client used here; pass `supabase as unknown as PushClient` at the boundary. */
export interface PushClient {
  rpc(
    fn: 'register_push_subscription',
    args: { p_endpoint: string; p_p256dh: string; p_auth: string; p_user_agent: string | null },
  ): PromiseLike<ResultLike>;
  from(table: 'push_subscriptions'): {
    select(columns: string): { eq(column: 'endpoint', value: string): { maybeSingle(): PromiseLike<ResultLike> } };
    update(values: PushSubscriptionPrefsUpdate): {
      eq(column: 'endpoint', value: string): { select(columns: string): PromiseLike<ResultLike> };
    };
    delete(): { eq(column: 'endpoint', value: string): PromiseLike<ResultLike> };
  };
}

/** Per-device preferences: direct update of the caller's own row (column grants). */
export interface PushSubscriptionPrefsUpdate {
  notify_running_low?: boolean;
  notify_digest?: boolean;
  last_seen_at?: IsoDateTime;
}

/** Per-device record (§1.4): the endpoint last saved and the VAPID key that created it. */
export interface LocalPushRecord {
  userId: UserId;
  endpoint: string;
  vapidPublicKey: string;
  savedAt: IsoDateTime;
}

export interface LocalPushStore {
  get(): Promise<LocalPushRecord | null>;
  set(record: LocalPushRecord): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Default record store in `localStorage`. 04 §1.1 places it in IndexedDB `meta` (key `push`), which
 * belongs to src/shared/db; swap this for that store once it exists.
 */
export function localStoragePushStore(key = 'cellier:push'): LocalPushStore {
  const storage = (): Storage | null => {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
      return null;
    }
  };
  return {
    async get() {
      try {
        const raw = storage()?.getItem(key);
        return raw ? (JSON.parse(raw) as LocalPushRecord) : null;
      } catch {
        return null;
      }
    },
    async set(record) {
      try {
        storage()?.setItem(key, JSON.stringify(record));
      } catch {
        // best effort
      }
    },
    async clear() {
      try {
        storage()?.removeItem(key);
      } catch {
        // best effort
      }
    },
  };
}

export interface PushDeps {
  env: PushEnvironment;
  client: PushClient;
  store: LocalPushStore;
  /** `import.meta.env.VITE_VAPID_PUBLIC_KEY` (base64url, 87 characters). */
  vapidPublicKey: string | undefined;
  now?: () => number;
  /** Reads and clears the service worker's `pushsubscriptionchange` record (default: IndexedDB `cellier-sw`). */
  takePendingChange?: () => Promise<PendingSubscriptionChange | null>;
}

// ---------------------------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------------------------

export interface PushPreferences {
  notifyRunningLow: boolean;
  notifyDigest: boolean;
}

/**
 * What the Notifications settings screen renders (contract `PushAvailability`, §1.2):
 * - `needs-install`: iOS in a Safari tab (contract 'not-installed'); show the install guide;
 * - `unsupported`: no Web Push here (iOS < 16.4, other browsers);
 * - `default`: show «Activer les notifications»;
 * - `denied`: point to iOS Settings; never ask again;
 * - `interrupted`: granted but no subscription (contract 'granted-not-subscribed'); offer «Réactiver»;
 * - `subscribed`: show the two switches; `prefs` is null until read (or when offline).
 */
export type PushStatus =
  | { kind: 'loading' }
  | { kind: 'unsupported' }
  | { kind: 'needs-install' }
  | { kind: 'default' }
  | { kind: 'denied' }
  | { kind: 'interrupted' }
  | { kind: 'subscribed'; endpoint: string; prefs: PushPreferences | null };

export type EnablePushResult =
  | { ok: true }
  | { ok: false; reason: 'not-installed' | 'unsupported' | 'denied' | 'dismissed' | 'save-failed' | 'error' };

/** Status without network access (prefs null). */
export async function readPushStatus(env: PushEnvironment): Promise<Exclude<PushStatus, { kind: 'loading' }>> {
  if (env.isIOS && !env.isStandalone) return { kind: 'needs-install' };
  if (!env.pushSupported) return { kind: 'unsupported' };
  const permission = env.permission();
  if (permission === 'denied') return { kind: 'denied' };
  if (permission === 'default') return { kind: 'default' };
  try {
    const sub = await (await env.pushManager()).getSubscription();
    return sub ? { kind: 'subscribed', endpoint: sub.endpoint, prefs: null } : { kind: 'interrupted' };
  } catch {
    return { kind: 'interrupted' };
  }
}

// ---------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------

const iso = (deps: PushDeps) => new Date((deps.now ?? Date.now)()).toISOString();

async function register(deps: PushDeps, sub: PushSubscriptionLike, userId: UserId): Promise<boolean> {
  const json = strictSubscriptionJSON(sub.toJSON());
  if (!json || !deps.vapidPublicKey) return false;
  try {
    const { error } = await deps.client.rpc('register_push_subscription', {
      p_endpoint: json.endpoint,
      p_p256dh: json.keys.p256dh,
      p_auth: json.keys.auth,
      p_user_agent: deps.env.userAgent.slice(0, 400) || null,
    });
    if (error) return false;
  } catch {
    return false;
  }
  await deps.store.set({ userId, endpoint: json.endpoint, vapidPublicKey: deps.vapidPublicKey, savedAt: iso(deps) });
  return true;
}

async function deleteRow(deps: PushDeps, endpoint: string, timeoutMs = 3000): Promise<void> {
  const request = Promise.resolve(deps.client.from('push_subscriptions').delete().eq('endpoint', endpoint));
  await Promise.race([request.catch(() => undefined), new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
}

function subscribe(deps: PushDeps, manager: Awaited<ReturnType<PushEnvironment['pushManager']>>) {
  if (!deps.vapidPublicKey) return Promise.reject(new Error('VITE_VAPID_PUBLIC_KEY is not set'));
  return manager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(deps.vapidPublicKey) });
}

/**
 * §1.3. Call directly from the button's click handler: the permission request is the first
 * awaited call, as WebKit requires a user gesture.
 */
export async function enablePush(deps: PushDeps, userId: UserId): Promise<EnablePushResult> {
  const { env } = deps;
  if (!env.pushSupported) return { ok: false, reason: 'unsupported' };
  let permission: NotificationPermission;
  try {
    permission = await env.requestPermission();
  } catch {
    return { ok: false, reason: 'error' };
  }
  if (permission === 'denied') return { ok: false, reason: 'denied' };
  if (permission !== 'granted') return { ok: false, reason: 'dismissed' };

  let sub: PushSubscriptionLike;
  try {
    const manager = await env.pushManager();
    const existing = await manager.getSubscription();
    const record = await deps.store.get();
    if (existing && record && record.vapidPublicKey !== deps.vapidPublicKey) {
      await existing.unsubscribe().catch(() => false);
      sub = await subscribe(deps, manager);
    } else {
      sub = existing ?? (await subscribe(deps, manager));
    }
  } catch {
    return { ok: false, reason: env.isIOS && !env.isStandalone ? 'not-installed' : 'error' };
  }
  return (await register(deps, sub, userId)) ? { ok: true } : { ok: false, reason: 'save-failed' };
}

/**
 * §1.5. Once per cold start (and on foreground after 12 h), when signed in and online. Never
 * prompts. Re-subscribes a lost subscription, re-subscribes after a VAPID key change, picks up a
 * subscription replaced by the service worker (`pushsubscriptionchange`), and refreshes the row
 * (`register_push_subscription` also bumps `last_seen_at`). Returns the resulting status.
 */
export async function reconcilePush(deps: PushDeps, userId: UserId): Promise<PushStatus> {
  const { env } = deps;
  const status = await readPushStatus(env);
  const record = await deps.store.get();

  if (status.kind === 'denied' && record) {
    await deleteRow(deps, record.endpoint);
    await deps.store.clear();
    return status;
  }
  if (status.kind !== 'subscribed' && status.kind !== 'interrupted') return status;

  const pending = await (deps.takePendingChange ?? takePendingSubscriptionChange)().catch(() => null);
  try {
    const manager = await env.pushManager();
    let sub = await manager.getSubscription();
    if (sub && record && record.vapidPublicKey !== deps.vapidPublicKey) {
      await sub.unsubscribe().catch(() => false);
      sub = null;
    }
    sub ??= await subscribe(deps, manager);
    if (!(await register(deps, sub, userId))) return { kind: 'subscribed', endpoint: sub.endpoint, prefs: null };
    const stale = new Set([record?.userId === userId ? record.endpoint : null, pending?.oldEndpoint ?? null]);
    for (const endpoint of stale) if (endpoint && endpoint !== sub.endpoint) await deleteRow(deps, endpoint);
    return { kind: 'subscribed', endpoint: sub.endpoint, prefs: null };
  } catch {
    return { kind: 'interrupted' };
  }
}

/**
 * §1.8 / settings «Désactiver»: deletes this device's row (3 s timeout, best effort), then
 * unsubscribes so the endpoint is dead at the push service even offline, then clears the record.
 * Call it before `supabase.auth.signOut()`.
 */
export async function disablePush(deps: PushDeps): Promise<void> {
  let sub: PushSubscriptionLike | null = null;
  try {
    sub = deps.env.pushSupported ? await (await deps.env.pushManager()).getSubscription() : null;
  } catch {
    sub = null;
  }
  const record = await deps.store.get();
  const endpoint = sub?.endpoint ?? record?.endpoint;
  if (endpoint) await deleteRow(deps, endpoint);
  await sub?.unsubscribe().catch(() => false);
  await deps.store.clear();
}

// ---------------------------------------------------------------------------------------------
// Per-device switches (push_subscriptions.notify_running_low / notify_digest)
// ---------------------------------------------------------------------------------------------

export type PreferencesResult = { ok: true; prefs: PushPreferences } | { ok: false; reason: 'not-found' | 'failed' };

function toPrefs(row: unknown): PushPreferences | null {
  const r = row as { notify_running_low?: unknown; notify_digest?: unknown } | null;
  if (!r || typeof r.notify_running_low !== 'boolean' || typeof r.notify_digest !== 'boolean') return null;
  return { notifyRunningLow: r.notify_running_low, notifyDigest: r.notify_digest };
}

const PREF_COLUMNS = 'notify_running_low,notify_digest';

export async function readPushPreferences(client: PushClient, endpoint: string): Promise<PreferencesResult> {
  try {
    const { data, error } = await client
      .from('push_subscriptions')
      .select(PREF_COLUMNS)
      .eq('endpoint', endpoint)
      .maybeSingle();
    if (error) return { ok: false, reason: 'failed' };
    const prefs = toPrefs(data);
    return prefs ? { ok: true, prefs } : { ok: false, reason: 'not-found' };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/** Online only: the settings screen disables the switches while offline (§1.10). */
export async function updatePushPreferences(
  client: PushClient,
  endpoint: string,
  change: Partial<PushPreferences>,
): Promise<PreferencesResult> {
  const update: PushSubscriptionPrefsUpdate = {};
  if (change.notifyRunningLow !== undefined) update.notify_running_low = change.notifyRunningLow;
  if (change.notifyDigest !== undefined) update.notify_digest = change.notifyDigest;
  try {
    const { data, error } = await client
      .from('push_subscriptions')
      .update(update)
      .eq('endpoint', endpoint)
      .select(PREF_COLUMNS);
    if (error) return { ok: false, reason: 'failed' };
    const prefs = toPrefs(Array.isArray(data) ? data[0] : data);
    return prefs ? { ok: true, prefs } : { ok: false, reason: 'not-found' };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
