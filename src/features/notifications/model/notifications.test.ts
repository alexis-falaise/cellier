import { describe, expect, it, vi } from 'vitest';
import type { UserId } from '@/domain/types';
import { detectIOS, type PushEnvironment, type PushSubscriptionLike } from './environment';
import {
  cellierData,
  NOTIFICATION_FALLBACK,
  notificationFromPush,
  notificationTargetPath,
  urlBase64ToUint8Array,
} from './payload';
import { strictSubscriptionJSON } from './pendingChange';
import {
  disablePush,
  enablePush,
  type LocalPushRecord,
  type LocalPushStore,
  type PushClient,
  readPushPreferences,
  readPushStatus,
  reconcilePush,
  updatePushPreferences,
} from './push';

const ORIGIN = 'https://cellier-one.vercel.app';
const PID = '3f6c1a2b-0000-4000-8000-000000000001';
const USER = 'user-1' as UserId;
// 65-byte uncompressed P-256 point, base64url (shape only; not a real key pair).
const KEY = `BA${'A'.repeat(85)}`;

describe('notificationFromPush (§2.1–2.2)', () => {
  const payload = {
    web_push: 8030,
    notification: {
      title: 'Pâtes : plus que 1',
      body: 'Seuil d’alerte atteint.',
      navigate: `${ORIGIN}/items/${PID}`,
      tag: `produit-${PID}`,
      lang: 'fr',
      dir: 'ltr',
      silent: false,
      data: {
        v: 1,
        kind: 'running_low',
        householdId: 'h',
        productIds: [PID],
        path: `/items/${PID}`,
        outboxIds: [1],
        sentAt: '',
      },
    },
  };

  it('shows the declarative notification on the classic path', () => {
    const { title, options } = notificationFromPush(payload);
    expect(title).toBe('Pâtes : plus que 1');
    expect(options).toMatchObject({
      body: 'Seuil d’alerte atteint.',
      tag: `produit-${PID}`,
      lang: 'fr',
      silent: false,
    });
    expect(cellierData(options.data)?.path).toBe(`/items/${PID}`);
  });

  it('falls back for anything else, so every push shows something', () => {
    for (const bad of [
      null,
      'text',
      {},
      { web_push: 8030 },
      { web_push: 1, notification: payload.notification },
      { web_push: 8030, notification: { title: ' ' } },
    ]) {
      const { title, options } = notificationFromPush(bad);
      expect(title).toBe(NOTIFICATION_FALLBACK.title);
      expect(options.body).toBe(NOTIFICATION_FALLBACK.body);
      expect(options.data).toEqual({ path: '/' });
    }
  });
});

describe('notificationTargetPath (§2.4)', () => {
  it('accepts only known routes', () => {
    expect(notificationTargetPath({ path: '/groceries' }, undefined, ORIGIN)).toBe('/groceries');
    expect(notificationTargetPath({ path: `/items/${PID}` }, undefined, ORIGIN)).toBe(`/items/${PID}`);
    expect(notificationTargetPath({ path: '/settings' }, undefined, ORIGIN)).toBe('/');
    expect(notificationTargetPath({ path: '//evil.example' }, undefined, ORIGIN)).toBe('/');
  });

  it('uses the navigate URL when data has no path, same origin only', () => {
    expect(notificationTargetPath(null, `${ORIGIN}/groceries`, ORIGIN)).toBe('/groceries');
    expect(notificationTargetPath({ navigate: `${ORIGIN}/groceries` }, undefined, ORIGIN)).toBe('/groceries');
    expect(notificationTargetPath(null, 'https://evil.example/groceries', ORIGIN)).toBe('/');
    expect(notificationTargetPath(null, 'not a url', ORIGIN)).toBe('/');
  });
});

describe('helpers', () => {
  it('decodes base64url keys', () => {
    expect(Array.from(urlBase64ToUint8Array('AQID_-8'))).toEqual([1, 2, 3, 255, 239]);
    expect(urlBase64ToUint8Array(KEY)).toHaveLength(65);
  });

  it('detects iOS and iPadOS', () => {
    expect(detectIOS('Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X)', 'iPhone', 5)).toBe(true);
    expect(detectIOS('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 5)).toBe(true);
    expect(detectIOS('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 0)).toBe(false);
  });

  it('requires both subscription keys', () => {
    expect(strictSubscriptionJSON({ endpoint: 'e', keys: { p256dh: 'p' } })).toBeNull();
    expect(strictSubscriptionJSON({ endpoint: 'e', keys: { p256dh: 'p', auth: 'a' } })).toEqual({
      endpoint: 'e',
      expirationTime: null,
      keys: { p256dh: 'p', auth: 'a' },
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------------------------

function fakeSub(endpoint: string): PushSubscriptionLike & { unsubscribed: boolean } {
  const sub = {
    endpoint,
    unsubscribed: false,
    toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: `p-${endpoint}`, auth: `a-${endpoint}` } }),
    unsubscribe: async () => {
      sub.unsubscribed = true;
      return true;
    },
  };
  return sub;
}

function fakeEnv(o: {
  ios?: boolean;
  standalone?: boolean;
  supported?: boolean;
  permission?: NotificationPermission;
  answer?: NotificationPermission;
  existing?: PushSubscriptionLike | null;
  subscribeFails?: boolean;
}) {
  let permission = o.permission ?? 'default';
  let current = o.existing ?? null;
  let n = 0;
  const order: string[] = [];
  const env: PushEnvironment = {
    isIOS: o.ios ?? true,
    isStandalone: o.standalone ?? true,
    pushSupported: o.supported ?? true,
    userAgent: 'test-agent',
    permission: () => permission,
    requestPermission: async () => {
      order.push('requestPermission');
      permission = o.answer ?? 'granted';
      return permission;
    },
    pushManager: async () => {
      order.push('pushManager');
      return {
        getSubscription: async () =>
          current && !(current as { unsubscribed?: boolean }).unsubscribed ? current : null,
        subscribe: async (opts) => {
          order.push('subscribe');
          expect(opts.userVisibleOnly).toBe(true);
          if (o.subscribeFails) throw new DOMException('not allowed', 'NotAllowedError');
          current = fakeSub(`https://web.push.apple.com/new-${++n}`);
          return current;
        },
      };
    },
  };
  return { env, order, current: () => current };
}

function fakeClient(o: { rpcError?: boolean; prefsRow?: unknown; updateRows?: unknown[] } = {}) {
  const calls = { rpc: [] as unknown[], deleted: [] as string[], updated: [] as unknown[] };
  const client: PushClient = {
    rpc: async (_fn, args) => {
      calls.rpc.push(args);
      return o.rpcError ? { data: null, error: { message: 'boom' } } : { data: 'sub-id', error: null };
    },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: o.prefsRow ?? null, error: null }) }),
      }),
      update: (values) => ({
        eq: () => ({
          select: async () => {
            calls.updated.push(values);
            return { data: o.updateRows ?? [], error: null };
          },
        }),
      }),
      delete: () => ({
        eq: async (_col, endpoint) => {
          calls.deleted.push(endpoint);
          return { data: null, error: null };
        },
      }),
    }),
  };
  return { client, calls };
}

function memoryStore(initial: LocalPushRecord | null = null): LocalPushStore & { value: LocalPushRecord | null } {
  const s = {
    value: initial,
    get: async () => s.value,
    set: async (r: LocalPushRecord) => {
      s.value = r;
    },
    clear: async () => {
      s.value = null;
    },
  };
  return s;
}

const deps = (env: PushEnvironment, client: PushClient, store: LocalPushStore) => ({
  env,
  client,
  store,
  vapidPublicKey: KEY as string | undefined,
  now: () => Date.UTC(2026, 10, 10),
  takePendingChange: async () => null,
});

describe('readPushStatus (§1.2)', () => {
  it('maps the environment to a status', async () => {
    expect((await readPushStatus(fakeEnv({ standalone: false }).env)).kind).toBe('needs-install');
    expect((await readPushStatus(fakeEnv({ ios: false, supported: false }).env)).kind).toBe('unsupported');
    expect((await readPushStatus(fakeEnv({ permission: 'default' }).env)).kind).toBe('default');
    expect((await readPushStatus(fakeEnv({ permission: 'denied' }).env)).kind).toBe('denied');
    expect((await readPushStatus(fakeEnv({ permission: 'granted' }).env)).kind).toBe('interrupted');
    const sub = fakeSub('https://e/1');
    expect(await readPushStatus(fakeEnv({ permission: 'granted', existing: sub }).env)).toEqual({
      kind: 'subscribed',
      endpoint: 'https://e/1',
      prefs: null,
    });
  });
});

describe('enablePush (§1.3)', () => {
  it('asks permission first, subscribes, registers through the RPC and stores the record', async () => {
    const { env, order } = fakeEnv({});
    const { client, calls } = fakeClient();
    const store = memoryStore();
    expect(await enablePush(deps(env, client, store), USER)).toEqual({ ok: true });
    expect(order[0]).toBe('requestPermission');
    expect(order).toContain('subscribe');
    expect(calls.rpc).toEqual([
      {
        p_endpoint: 'https://web.push.apple.com/new-1',
        p_p256dh: 'p-https://web.push.apple.com/new-1',
        p_auth: 'a-https://web.push.apple.com/new-1',
        p_user_agent: 'test-agent',
      },
    ]);
    expect(store.value).toMatchObject({
      userId: USER,
      endpoint: 'https://web.push.apple.com/new-1',
      vapidPublicKey: KEY,
    });
  });

  it('reports unsupported, denied and dismissed', async () => {
    const { client } = fakeClient();
    const store = memoryStore();
    expect(await enablePush(deps(fakeEnv({ supported: false }).env, client, store), USER)).toEqual({
      ok: false,
      reason: 'unsupported',
    });
    expect(await enablePush(deps(fakeEnv({ answer: 'denied' }).env, client, store), USER)).toEqual({
      ok: false,
      reason: 'denied',
    });
    expect(await enablePush(deps(fakeEnv({ answer: 'default' }).env, client, store), USER)).toEqual({
      ok: false,
      reason: 'dismissed',
    });
  });

  it('reports not-installed when subscribe fails in a Safari tab, error elsewhere', async () => {
    const { client } = fakeClient();
    const tab = fakeEnv({ standalone: false, subscribeFails: true }).env;
    expect(await enablePush(deps(tab, client, memoryStore()), USER)).toEqual({ ok: false, reason: 'not-installed' });
    const installed = fakeEnv({ subscribeFails: true }).env;
    expect(await enablePush(deps(installed, client, memoryStore()), USER)).toEqual({ ok: false, reason: 'error' });
    const noKey = fakeEnv({}).env;
    expect(await enablePush({ ...deps(noKey, client, memoryStore()), vapidPublicKey: undefined }, USER)).toEqual({
      ok: false,
      reason: 'error',
    });
  });

  it('reports save-failed when the RPC fails', async () => {
    const { client } = fakeClient({ rpcError: true });
    const store = memoryStore();
    expect(await enablePush(deps(fakeEnv({}).env, client, store), USER)).toEqual({ ok: false, reason: 'save-failed' });
    expect(store.value).toBeNull();
  });

  it('re-subscribes when the existing subscription was made with another VAPID key', async () => {
    const old = fakeSub('https://e/old');
    const { env } = fakeEnv({ permission: 'granted', existing: old });
    const { client } = fakeClient();
    const store = memoryStore({ userId: USER, endpoint: old.endpoint, vapidPublicKey: 'OLD', savedAt: '' });
    expect(await enablePush(deps(env, client, store), USER)).toEqual({ ok: true });
    expect(old.unsubscribed).toBe(true);
    expect(store.value?.endpoint).toBe('https://web.push.apple.com/new-1');
  });
});

describe('reconcilePush (§1.5)', () => {
  it('re-subscribes a lost subscription and deletes the old row', async () => {
    const { env } = fakeEnv({ permission: 'granted' });
    const { client, calls } = fakeClient();
    const store = memoryStore({ userId: USER, endpoint: 'https://e/lost', vapidPublicKey: KEY, savedAt: '' });
    const status = await reconcilePush(deps(env, client, store), USER);
    expect(status).toMatchObject({ kind: 'subscribed', endpoint: 'https://web.push.apple.com/new-1' });
    expect(calls.rpc).toHaveLength(1);
    expect(calls.deleted).toEqual(['https://e/lost']);
  });

  it('reports interrupted when silent re-subscription is refused', async () => {
    const { env } = fakeEnv({ permission: 'granted', subscribeFails: true });
    const { client } = fakeClient();
    expect(await reconcilePush(deps(env, client, memoryStore()), USER)).toEqual({ kind: 'interrupted' });
  });

  it('refreshes an unchanged subscription without deleting anything', async () => {
    const sub = fakeSub('https://e/1');
    const { env } = fakeEnv({ permission: 'granted', existing: sub });
    const { client, calls } = fakeClient();
    const store = memoryStore({ userId: USER, endpoint: sub.endpoint, vapidPublicKey: KEY, savedAt: '' });
    await reconcilePush(deps(env, client, store), USER);
    expect(calls.rpc).toHaveLength(1);
    expect(calls.deleted).toEqual([]);
  });

  it('saves a subscription replaced by the service worker and drops the old endpoint', async () => {
    const sub = fakeSub('https://e/new');
    const { env } = fakeEnv({ permission: 'granted', existing: sub });
    const { client, calls } = fakeClient();
    const d = {
      ...deps(env, client, memoryStore()),
      takePendingChange: async () => ({ at: '', oldEndpoint: 'https://e/old', newSubscription: null }),
    };
    await reconcilePush(d, USER);
    expect(calls.deleted).toEqual(['https://e/old']);
  });

  it('never deletes the row of another user’s record', async () => {
    const sub = fakeSub('https://e/mine');
    const { env } = fakeEnv({ permission: 'granted', existing: sub });
    const { client, calls } = fakeClient();
    const store = memoryStore({
      userId: 'other' as UserId,
      endpoint: 'https://e/theirs',
      vapidPublicKey: KEY,
      savedAt: '',
    });
    await reconcilePush(deps(env, client, store), USER);
    expect(calls.deleted).toEqual([]);
    expect(store.value?.userId).toBe(USER);
  });

  it('cleans up when permission was revoked', async () => {
    const { env } = fakeEnv({ permission: 'denied' });
    const { client, calls } = fakeClient();
    const store = memoryStore({ userId: USER, endpoint: 'https://e/1', vapidPublicKey: KEY, savedAt: '' });
    expect((await reconcilePush(deps(env, client, store), USER)).kind).toBe('denied');
    expect(calls.deleted).toEqual(['https://e/1']);
    expect(store.value).toBeNull();
  });

  it('does nothing before permission is granted', async () => {
    const { env, order } = fakeEnv({ permission: 'default' });
    const { client, calls } = fakeClient();
    expect((await reconcilePush(deps(env, client, memoryStore()), USER)).kind).toBe('default');
    expect(order).not.toContain('requestPermission');
    expect(calls.rpc).toEqual([]);
  });
});

describe('disablePush (§1.8)', () => {
  it('deletes the row, unsubscribes and clears the record, even when the delete hangs', async () => {
    vi.useFakeTimers();
    try {
      const sub = fakeSub('https://e/1');
      const { env } = fakeEnv({ permission: 'granted', existing: sub });
      const hanging: PushClient = {
        ...fakeClient().client,
        from: () => ({
          ...fakeClient().client.from('push_subscriptions'),
          delete: () => ({ eq: () => new Promise(() => {}) }),
        }),
      };
      const store = memoryStore({ userId: USER, endpoint: sub.endpoint, vapidPublicKey: KEY, savedAt: '' });
      const done = disablePush(deps(env, hanging, store));
      await vi.advanceTimersByTimeAsync(3000);
      await done;
      expect(sub.unsubscribed).toBe(true);
      expect(store.value).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('per-device switches (§1.10)', () => {
  it('reads and updates notify_running_low / notify_digest', async () => {
    const { client, calls } = fakeClient({
      prefsRow: { notify_running_low: true, notify_digest: false },
      updateRows: [{ notify_running_low: false, notify_digest: false }],
    });
    expect(await readPushPreferences(client, 'https://e/1')).toEqual({
      ok: true,
      prefs: { notifyRunningLow: true, notifyDigest: false },
    });
    expect(await updatePushPreferences(client, 'https://e/1', { notifyRunningLow: false })).toEqual({
      ok: true,
      prefs: { notifyRunningLow: false, notifyDigest: false },
    });
    expect(calls.updated).toEqual([{ notify_running_low: false }]);
  });

  it('reports a missing row', async () => {
    const { client } = fakeClient();
    expect(await readPushPreferences(client, 'x')).toEqual({ ok: false, reason: 'not-found' });
    expect(await updatePushPreferences(client, 'x', { notifyDigest: true })).toEqual({
      ok: false,
      reason: 'not-found',
    });
  });
});
