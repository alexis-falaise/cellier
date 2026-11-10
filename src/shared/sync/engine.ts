/**
 * Sync engine (02 §6.2–§6.5, §7, §8): boot from IndexedDB, optimistic `mutate`, the single sync
 * cycle (flush through `apply_mutations`, then `pull_changes`), triggers, backoff and Realtime nudges.
 * Network access goes through an injected `SyncTransport`.
 */
import type {
  AnyMutationEnvelope,
  ApplyMutationsResponse,
  DeviceId,
  Hlc,
  HouseholdId,
  IsoDateTime,
  MutationArgs,
  MutationId,
  MutationName,
  PullResponse,
  SyncStatus,
} from '@/domain/types';
import { stockKey } from '@/domain/types';
import type { CellierDatabase } from '@/shared/db/cellierDb';
import {
  type MetaCursor,
  type MetaDevice,
  MutationValidationError,
  type SyncEngine,
  type SyncTrigger,
} from './contract';
import { createBrowserEnvironment, type EngineEnvironment } from './environment';
import { createHybridClock, formatHlc, type PersistableClock } from './hlc';
import { createdRowId, createOutbox, type LocalOutboxEntry, type SyncOutbox } from './outbox';
import { findProductByNaturalKey, openGroceryEntryFor, type ReducerDraft, validateMutation } from './reducers';
import { type CellierStore, createSyncStore } from './store';
import { type SyncTransport, TransportError } from './transport';
import { collectStrings, normalizeName, rewriteIds } from './util';

export interface EngineOptions {
  db: CellierDatabase;
  transport: SyncTransport;
  /** The signed-in user (movement actor in optimistic rows, own member row). */
  userId: string;
  /** Household to open; omitted: the stored `active-household`. */
  householdId?: HouseholdId | null;
  store?: CellierStore;
  environment?: EngineEnvironment;
  /** Debounce of the cycle scheduled by `mutate` (02 §6.2 step 5). Default 250 ms. */
  debounceMs?: number;
  /** Request timeout (02 §8). Default 15 s. */
  requestTimeoutMs?: number;
  /** Pull page size (1..1000). Default: server default (500). */
  pullLimit?: number;
  now?: () => number;
  random?: () => number;
  uuid?: () => string;
}

export interface CellierSyncEngine extends SyncEngine {
  readonly store: CellierStore;
  readonly outbox: SyncOutbox;
  readonly clock: PersistableClock;
  readonly deviceId: DeviceId | null;
  readonly householdId: HouseholdId | null;
  /**
   * Undo of a mutation of this device: an unsent entry is simply dropped; otherwise the inverse
   * mutation is enqueued (`stock.revert` for stock, restore/delete for tombstones and creates).
   * Resolves the id of the inverse mutation, or null when the entry was dropped.
   * Throws MutationValidationError('not_revertible') for updates and recounts.
   */
  undo(mutationId: MutationId): Promise<MutationId | null>;
  /** Canonical id of a row id that was merged into another (02 §7 remap). */
  resolveId(id: string): string;
  markActivityRead(ids: string[]): Promise<void>;
  /** "À vérifier" actions (02 §7). */
  discardAttention(id: MutationId): Promise<void>;
  retryAttention(id: MutationId): Promise<void>;
  /** Quarantine (02 §9 case 15): the pending changes as CSV, and discarding them. */
  quarantineCsv(): string;
  discardQuarantined(): Promise<void>;
  /** Resolves when enqueue writes have committed and no cycle is running (tests, sign-out). */
  settle(): Promise<void>;
}

const MAX_BACKOFF_MS = 60_000;
const CONTRACT_RETRY_MS = 60 * 60 * 1000;
const TIMER_PENDING_MS = 30_000;
const TIMER_IDLE_MS = 5 * 60_000;
const ONLINE_SETTLE_MS = 1_000;
const HLC_PERSIST_MS = 1_000;

class NotMemberSignal extends Error {}

function isApplyResponse(x: unknown): x is ApplyMutationsResponse {
  const r = x as ApplyMutationsResponse | null;
  return (
    !!r &&
    (r.status === 'ok' || r.status === 'not_member') &&
    Array.isArray(r.results) &&
    typeof r.lastSyncId === 'number' &&
    typeof r.serverTime === 'string'
  );
}

function isPullResponse(x: unknown): x is PullResponse {
  const r = x as PullResponse | null;
  if (!r || (r.status !== 'ok' && r.status !== 'resync_required' && r.status !== 'not_member')) return false;
  if (r.status !== 'ok') return true;
  return (
    (r.mode === 'snapshot' || r.mode === 'delta') &&
    typeof r.toSyncId === 'number' &&
    typeof r.hasMore === 'boolean' &&
    !!r.upserts &&
    typeof r.upserts === 'object' &&
    Array.isArray(r.deletes)
  );
}

export function createSyncEngine(options: EngineOptions): CellierSyncEngine {
  const { db, transport, userId } = options;
  const env = options.environment ?? createBrowserEnvironment();
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const uuid = options.uuid ?? (() => crypto.randomUUID());
  const debounceMs = options.debounceMs ?? 250;
  const timeoutMs = options.requestTimeoutMs ?? 15_000;
  const store = options.store ?? createSyncStore();
  const iso = (): IsoDateTime => new Date(now()).toISOString();

  let device: MetaDevice | null = null;
  let clock: PersistableClock = createHybridClock({
    deviceId: '00000000-0000-0000-0000-000000000000' as DeviceId,
    now,
  });
  let householdId: HouseholdId | null = null;
  let stopped = true;
  let running: Promise<void> | null = null;
  let rerun = false;
  let lastCycleOk = true;
  let backoffAttempt = 0;
  let contractBlockedUntil = 0;
  let authRefreshTried = false;
  let authFailed = false;
  let lastSyncedAt: IsoDateTime | null = null;
  let lastHlcPersist = 0;
  let debounceTimer: unknown = null;
  let retryTimer: unknown = null;
  let pollTimer: unknown = null;
  let leaveChannel: (() => void) | null = null;
  let channelDropped = false;
  const unsubscribers: Array<() => void> = [];

  const outbox: SyncOutbox = createOutbox({
    db,
    store,
    now,
    uuid,
    enqueue: (name, args) => engine.mutate(name, args),
  });

  // ------------------------------------------------------------------------------------------
  // Status and timers
  // ------------------------------------------------------------------------------------------

  const pendingCount = () => (householdId ? outbox.pendingCount(householdId) : 0);

  function setStatus(status: SyncStatus) {
    store.setStatus(status);
  }

  function clearTimer(handle: unknown) {
    if (handle !== null) env.clearTimeout(handle);
  }

  function clearTimers() {
    clearTimer(debounceTimer);
    clearTimer(retryTimer);
    clearTimer(pollTimer);
    debounceTimer = retryTimer = pollTimer = null;
  }

  function scheduleSync(ms: number, trigger: SyncTrigger) {
    clearTimer(debounceTimer);
    debounceTimer = env.setTimeout(() => {
      debounceTimer = null;
      void engine.sync(trigger);
    }, ms);
  }

  /** Visible-only timer (02 §6.5): 30 s with pending changes, 5 min otherwise. */
  function schedulePoll() {
    clearTimer(pollTimer);
    pollTimer = null;
    if (stopped || !householdId || !env.isVisible()) return;
    pollTimer = env.setTimeout(
      () => {
        pollTimer = null;
        void engine.sync('timer');
      },
      pendingCount() > 0 ? TIMER_PENDING_MS : TIMER_IDLE_MS,
    );
  }

  function scheduleRetry(kind: 'transport' | 'server', retryAfterMs?: number) {
    const delay = Math.max(
      Math.min(MAX_BACKOFF_MS, 1000 * 2 ** backoffAttempt) * (0.5 + random() / 2),
      retryAfterMs ?? 0,
    );
    backoffAttempt += 1;
    const retryAt = now() + delay;
    if (kind === 'transport' && !env.isOnline()) setStatus({ kind: 'offline', pendingCount: pendingCount() });
    else setStatus({ kind: 'error', pendingCount: pendingCount(), retryAt, reason: kind });
    clearTimer(retryTimer);
    retryTimer = env.setTimeout(() => {
      retryTimer = null;
      void engine.sync('timer');
    }, delay);
  }

  // ------------------------------------------------------------------------------------------
  // Network calls
  // ------------------------------------------------------------------------------------------

  async function call<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const ctrl = new AbortController();
    let timer: unknown = null;
    const timeout = new Promise<never>((_, reject) => {
      timer = env.setTimeout(() => {
        ctrl.abort();
        reject(new TransportError('transport', 'request timed out'));
      }, timeoutMs);
    });
    try {
      return await Promise.race([fn(ctrl.signal), timeout]);
    } catch (error) {
      if (error instanceof TransportError) throw error;
      throw new TransportError('transport', error instanceof Error ? error.message : String(error));
    } finally {
      clearTimer(timer);
    }
  }

  function observeServerTime(serverTime: string) {
    clock.observe(serverTime);
    store.setClockSkew(clock.skewMs);
  }

  // ------------------------------------------------------------------------------------------
  // The cycle (02 §6.3)
  // ------------------------------------------------------------------------------------------

  async function flush(hid: HouseholdId): Promise<void> {
    if (!device) return;
    for (;;) {
      if (stopped || hid !== householdId) return;
      const batch = outbox.nextBatch(hid);
      if (batch.length === 0) return;
      const ids = batch.map((e) => e.id);
      await outbox.markInflight(ids);
      let response: ApplyMutationsResponse;
      try {
        const raw = await call((signal) =>
          transport.applyMutations(
            { householdId: hid, deviceId: (device as MetaDevice).deviceId, mutations: batch.map((e) => e.envelope) },
            signal,
          ),
        );
        if (!isApplyResponse(raw)) throw new TransportError('contract', 'unexpected apply_mutations response');
        response = raw;
      } catch (error) {
        await outbox.requeue(ids);
        throw error;
      }
      observeServerTime(response.serverTime);
      await outbox.handleResponse(batch, response);
      if (response.status === 'not_member' || response.results.some((r) => r.status === 'forbidden')) {
        throw new NotMemberSignal();
      }
      if (response.results.some((r) => r.status === 'retry')) {
        throw new TransportError('server', 'apply_mutations asked to retry');
      }
    }
  }

  /**
   * Pulls until `hasMore` is false. Each page is committed to IndexedDB as it arrives; the store gets
   * all pages in one batch at the end (or on failure), so the view never shows a half-applied delta.
   */
  async function pull(hid: HouseholdId): Promise<void> {
    const pages: PullResponse[] = [];
    try {
      await pullPages(hid, pages);
    } finally {
      if (pages.length > 0 && hid === householdId)
        store.batch(() => {
          for (const p of pages) store.applyPage(p);
        });
    }
  }

  async function pullPages(hid: HouseholdId, pages: PullResponse[]): Promise<void> {
    let since = store.getSnapshot().cursor;
    let resynced = false;
    for (;;) {
      if (stopped || hid !== householdId) return;
      const request = { householdId: hid, since, ...(options.pullLimit ? { limit: options.pullLimit } : {}) };
      const page = await call((signal) => transport.pullChanges(request, signal));
      if (!isPullResponse(page)) throw new TransportError('contract', 'unexpected pull_changes response');
      if (page.status === 'not_member') throw new NotMemberSignal();
      if (page.status === 'resync_required') {
        if (resynced) throw new TransportError('contract', 'resync_required after a snapshot');
        resynced = true;
        since = 0;
        continue;
      }
      if (hid !== householdId) return;
      await db.applyPull(hid, page);
      pages.push(page);
      observeServerTime(page.serverTime);
      since = page.toSyncId;
      if (!page.hasMore) return;
    }
  }

  async function runCycle(hid: HouseholdId): Promise<void> {
    if (stopped || hid !== householdId) return;
    if (contractBlockedUntil > now()) return;
    setStatus({ kind: 'syncing' });
    try {
      await flush(hid);
      await pull(hid);
      if (hid !== householdId) return;
      await outbox.prune(hid, store.getSnapshot().cursor);
      backoffAttempt = 0;
      authRefreshTried = false;
      authFailed = false;
      lastCycleOk = true;
      lastSyncedAt = iso();
      setStatus({ kind: 'idle', lastSyncedAt });
      schedulePoll();
    } catch (error) {
      lastCycleOk = false;
      await handleCycleError(hid, error);
    }
  }

  async function handleCycleError(hid: HouseholdId, error: unknown): Promise<void> {
    if (error instanceof NotMemberSignal) {
      await outbox.quarantineAll(hid);
      store.setNotice('not_member');
      leaveChannel?.();
      leaveChannel = null;
      setStatus({ kind: 'idle', lastSyncedAt });
      return;
    }
    if (!(error instanceof TransportError)) {
      console.error('[sync] cycle failed', error);
      scheduleRetry('transport');
      return;
    }
    switch (error.kind) {
      case 'auth': {
        if (!authRefreshTried) {
          authRefreshTried = true;
          const ok = await transport.refreshSession().catch(() => false);
          if (ok) {
            scheduleSync(0, 'manual');
            return;
          }
        }
        authFailed = true;
        setStatus({ kind: 'error', pendingCount: pendingCount(), retryAt: 0, reason: 'auth' });
        return;
      }
      case 'contract': {
        console.error('[sync] contract error: the server may be newer than the app', error.message);
        contractBlockedUntil = now() + CONTRACT_RETRY_MS;
        setStatus({ kind: 'error', pendingCount: pendingCount(), retryAt: contractBlockedUntil, reason: 'contract' });
        clearTimer(retryTimer);
        retryTimer = env.setTimeout(() => {
          retryTimer = null;
          void engine.sync('timer');
        }, CONTRACT_RETRY_MS);
        return;
      }
      case 'server':
        scheduleRetry('server', error.retryAfterMs);
        return;
      case 'transport':
        scheduleRetry('transport');
        return;
    }
  }

  // ------------------------------------------------------------------------------------------
  // Realtime and triggers (02 §6.5)
  // ------------------------------------------------------------------------------------------

  function joinChannel(hid: HouseholdId) {
    leaveChannel?.();
    channelDropped = false;
    leaveChannel = transport.subscribe(hid, {
      onSync(nudge) {
        if (hid !== householdId) return;
        if (typeof nudge?.syncId === 'number' && nudge.syncId > store.getSnapshot().cursor) void engine.sync('nudge');
      },
      onHouseholdDeleted(nudge) {
        if (hid !== householdId || (nudge?.householdId && nudge.householdId !== hid)) return;
        void outbox.quarantineAll(hid).then(() => store.setNotice('household_deleted'));
      },
      onStatus(status) {
        if (status === 'subscribed') {
          if (channelDropped) {
            channelDropped = false;
            void engine.sync('channel_resubscribed');
          }
        } else {
          channelDropped = true;
        }
      },
    });
  }

  function attachListeners() {
    unsubscribers.push(env.onOnline(() => scheduleSync(ONLINE_SETTLE_MS, 'online')));
    unsubscribers.push(
      env.onVisibilityChange((visible) => {
        if (!householdId) return;
        if (visible) {
          if (channelDropped || !leaveChannel) joinChannel(householdId);
          void engine.sync('visible');
        } else {
          clearTimer(pollTimer);
          pollTimer = null;
          void engine.sync('hidden');
        }
      }),
    );
    unsubscribers.push(
      transport.onTokenRefreshed(() => {
        if (authFailed) {
          authRefreshTried = false;
          void engine.sync('token_refreshed');
        }
      }),
    );
  }

  // ------------------------------------------------------------------------------------------
  // Household activation
  // ------------------------------------------------------------------------------------------

  function leaveHousehold() {
    leaveChannel?.();
    leaveChannel = null;
    clearTimers();
    outbox.clear();
    householdId = null;
    store.reset();
    store.setUser(userId);
  }

  async function activate(hid: HouseholdId): Promise<void> {
    householdId = hid;
    await db.putMeta('active-household', hid);
    const [{ rows, outbox: list }, cursorMeta, aliases, activity] = await Promise.all([
      db.readHousehold(hid),
      db.getMeta<MetaCursor>(`cursor:${hid}`),
      db.readAliases(hid),
      db.listActivity(hid),
    ]);
    if (householdId !== hid) return;
    outbox.load(hid, list);
    lastSyncedAt = cursorMeta?.pulledAt ?? null;
    store.batch(() => {
      store.hydrate(hid, rows, outbox.all(), cursorMeta?.syncId ?? 0);
      if (Object.keys(aliases).length > 0) store.remap(aliases);
      store.setActivity(activity);
      setStatus(cursorMeta ? { kind: 'idle', lastSyncedAt } : { kind: 'booting' });
    });
    if (stopped) return;
    // Background: never block the first paint on the network (02 §6.4 step 5).
    env.persistStorage();
    void engine.sync('boot');
    joinChannel(hid);
  }

  function persistHlc(hlc: Hlc) {
    if (!device) return;
    device = { ...device, hlc };
    const t = now();
    if (t - lastHlcPersist < HLC_PERSIST_MS) return;
    lastHlcPersist = t;
    void db.putMeta('device', device).catch(() => undefined);
  }

  // ------------------------------------------------------------------------------------------
  // mutate: natural-key shortcuts (02 §3 product.create) and envelope building (02 §6.2)
  // ------------------------------------------------------------------------------------------

  type Shortcut = { existing: string } | null;

  /** A create whose natural key already exists locally uses that row instead of adding one. */
  function naturalKeyShortcut(name: MutationName, args: Record<string, unknown>, view: ReducerDraft): Shortcut {
    const restoreIfDeleted = (row: { id: string; deletedAt: string | null }, restore: MutationName, key: string) => {
      if (row.deletedAt !== null) enqueue(restore, { [key]: row.id } as never);
      return { existing: row.id };
    };
    if (name === 'pantry.create' || name === 'category.create') {
      const entity = name === 'pantry.create' ? 'pantry' : 'category';
      const idKey = entity === 'pantry' ? 'pantryId' : 'categoryId';
      if (view.get(entity, String(args[idKey]))) return null;
      if (typeof args.name !== 'string') return null;
      const key = normalizeName(args.name);
      for (const row of view.values(entity)) {
        if (normalizeName(row.name) === key) return restoreIfDeleted(row, `${entity}.restore` as MutationName, idKey);
      }
      return null;
    }
    if (name === 'product.create') {
      if (view.get('product', String(args.productId)) || typeof args.name !== 'string') return null;
      const gtin = typeof args.gtin === 'string' && args.gtin !== '' ? args.gtin : null;
      const match = findProductByNaturalKey(view, gtin, args.name);
      return match ? restoreIfDeleted(match, 'product.restore', 'productId') : null;
    }
    if (name === 'grocery.add' && typeof args.productId === 'string') {
      if (view.get('grocery', String(args.groceryId))) return null;
      const open = openGroceryEntryFor(view, args.productId);
      if (!open) return null;
      if (open.quantity === null && typeof args.quantity === 'number') {
        enqueue('grocery.update', { groceryId: open.id, fields: { quantity: args.quantity } });
      }
      return { existing: open.id };
    }
    return null;
  }

  function enqueue<N extends MutationName>(name: N, rawArgs: MutationArgs[N]): MutationId {
    if (!householdId || !device) throw new Error('Sync engine has no active household; call startSync first.');
    const aliases = Object.fromEntries(store.getSnapshot().aliases);
    const args = rewriteIds(rawArgs, aliases);
    const view = store.reader();

    const shortcut = naturalKeyShortcut(name, args as Record<string, unknown>, view);
    if (shortcut) return shortcut.existing as MutationId;

    const code = validateMutation(name, args, view);
    if (code) throw new MutationValidationError(name, code);

    const id = (createdRowId({ name, args } as AnyMutationEnvelope) ?? uuid()) as MutationId;
    const envelope = { id, seq: device.nextSeq, name, args, hlc: clock.next(), clientAt: iso() } as AnyMutationEnvelope;
    device = { ...device, nextSeq: device.nextSeq + 1, hlc: clock.current() };

    const referenced = collectStrings(args);
    const dependsOn = outbox
      .all()
      .filter((e) => e.state !== 'acked' && e.state !== 'quarantined' && referenced.has(e.id))
      .map((e) => e.id);

    const entry: LocalOutboxEntry = {
      id,
      householdId,
      seq: envelope.seq,
      envelope,
      state: 'pending',
      attempts: 0,
      createdAt: envelope.clientAt,
      dependsOn,
    };
    if (envelope.name === 'stock.recount') {
      const a = envelope.args;
      entry.predictedQuantity = view.get('stock', stockKey(a.pantryId, a.productId))?.quantity ?? 0;
    }
    outbox.add(entry, device).catch((error: unknown) => console.error('[sync] outbox write failed', error));
    if (!stopped) scheduleSync(debounceMs, 'mutate');
    return id;
  }

  const engine: CellierSyncEngine = {
    get store() {
      return store;
    },
    get outbox() {
      return outbox;
    },
    get clock() {
      return clock;
    },
    get deviceId() {
      return device?.deviceId ?? null;
    },
    get householdId() {
      return householdId;
    },

    async start() {
      stopped = false;
      let stored = await db.getMeta<MetaDevice>('device');
      if (!stored) {
        const deviceId = uuid() as DeviceId;
        stored = { deviceId, nextSeq: 1, hlc: formatHlc(0, 0, deviceId) };
        await db.putMeta('device', stored);
      }
      device = stored;
      clock = createHybridClock({ deviceId: stored.deviceId, initial: stored.hlc, now, onChange: persistHlc });
      store.setUser(userId);
      attachListeners();
      const hid =
        options.householdId !== undefined
          ? options.householdId
          : ((await db.getMeta<HouseholdId>('active-household')) ?? null);
      if (hid) await activate(hid);
      else setStatus({ kind: 'idle', lastSyncedAt: null });
    },

    stop() {
      stopped = true;
      leaveChannel?.();
      leaveChannel = null;
      clearTimers();
      for (const u of unsubscribers.splice(0)) u();
    },

    mutate: enqueue,

    sync(trigger) {
      if (stopped || !householdId) return Promise.resolve();
      if (trigger === 'manual') contractBlockedUntil = 0;
      if (running) {
        rerun = true;
        return running;
      }
      const hid = householdId;
      running = (async () => {
        try {
          do {
            rerun = false;
            await env.withLock(`cellier-sync:${hid}`, () => runCycle(hid));
          } while (rerun && lastCycleOk && !stopped && hid === householdId);
        } finally {
          running = null;
        }
      })();
      return running;
    },

    async setActiveHousehold(hid) {
      if (hid === householdId) return;
      await running?.catch(() => undefined);
      leaveHousehold();
      if (hid) await activate(hid);
      else {
        await db.putMeta('active-household', null);
        setStatus({ kind: 'idle', lastSyncedAt: null });
      }
    },

    async clear() {
      engine.stop();
      await running?.catch(() => undefined);
      await outbox.idle();
      leaveHousehold();
      await db.clearAll();
    },

    async undo(mutationId) {
      const entry = outbox.get(mutationId);
      if (entry?.state === 'pending' && (await outbox.cancel(mutationId))) return null;
      const name = entry?.envelope.name ?? (store.reader().get('movement', mutationId) ? 'stock.add' : null);
      const args = (entry?.envelope.args ?? {}) as Record<string, unknown>;
      switch (name) {
        case 'stock.add':
        case 'stock.remove':
        case 'stock.transfer':
          return enqueue('stock.revert', { movementId: mutationId as never });
        case 'pantry.delete':
          return enqueue('pantry.restore', { pantryId: args.pantryId as never });
        case 'pantry.restore':
          return enqueue('pantry.delete', { pantryId: args.pantryId as never });
        case 'pantry.create':
          return enqueue('pantry.delete', { pantryId: engine.resolveId(String(args.pantryId)) as never });
        case 'category.delete':
          return enqueue('category.restore', { categoryId: args.categoryId as never });
        case 'category.restore':
          return enqueue('category.delete', { categoryId: args.categoryId as never });
        case 'category.create':
          return enqueue('category.delete', { categoryId: engine.resolveId(String(args.categoryId)) as never });
        case 'product.delete':
          return enqueue('product.restore', { productId: args.productId as never });
        case 'product.restore':
          return enqueue('product.delete', { productId: args.productId as never });
        case 'product.create':
          return enqueue('product.delete', { productId: engine.resolveId(String(args.productId)) as never });
        case 'grocery.delete':
          return enqueue('grocery.restore', { groceryId: args.groceryId as never });
        case 'grocery.restore':
          return enqueue('grocery.delete', { groceryId: args.groceryId as never });
        case 'grocery.add':
          return enqueue('grocery.delete', { groceryId: engine.resolveId(String(args.groceryId)) as never });
        default:
          throw new MutationValidationError(name ?? 'stock.revert', name ? 'not_revertible' : 'not_found');
      }
    },

    resolveId(id) {
      const aliases = store.getSnapshot().aliases;
      let current = id;
      for (let i = 0; i < 8; i += 1) {
        const next = aliases.get(current);
        if (!next || next === current) break;
        current = next;
      }
      return current;
    },

    async markActivityRead(ids) {
      await db.markActivityRead(ids);
      const set = new Set(ids);
      store.setActivity(store.getSnapshot().activity.map((a) => (set.has(a.id) ? { ...a, read: true } : a)));
    },

    discardAttention: (id) => outbox.discard(id),
    retryAttention: (id) => outbox.retryWithRestore(id),

    quarantineCsv() {
      const rows = outbox.all().filter((e) => e.state === 'quarantined');
      const quote = (v: string) => `"${v.replaceAll('"', '""')}"`;
      const lines = ['clientAt,mutation,arguments'];
      for (const e of rows) {
        lines.push([e.envelope.clientAt, e.envelope.name, JSON.stringify(e.envelope.args)].map(quote).join(','));
      }
      return lines.join('\n');
    },

    async discardQuarantined() {
      await outbox.discardQuarantined();
      store.setNotice(null);
    },

    async settle() {
      await outbox.idle();
      while (running) await running;
    },
  };

  return engine;
}
