/**
 * In-memory store (02 §6.1): base maps (last server state), the overlay (this device's mutations not
 * yet in the base) and the view (base with the overlay folded on top), exposed as an immutable
 * snapshot for `useSyncExternalStore`. A commit replaces only the maps whose content changed, so
 * selectors keyed on map identity bail out when nothing they read changed.
 */
import type {
  CreateResultData,
  EntityName,
  EntityRowMap,
  HouseholdId,
  IsoDateTime,
  MutationId,
  PullResponse,
  SyncStatus,
} from '@/domain/types';
import { ENTITY_NAMES, rowIdOf } from '@/shared/db/cellierDb';
import type { ActivityEntry, EntityKey, OutboxEntry, StoredRow, StoreSnapshot, SyncStore } from './contract';
import { applyEnvelope, type ReducerDraft, type TouchContext, touchesOf } from './reducers';
import { rewriteIds } from './util';

type RowMaps = { [E in EntityName]: Map<string, EntityRowMap[E]> };

/**
 * Fields added to a row shape after devices had already cached rows (pulls are deltas, so an
 * unchanged row is never sent again). Cached rows get them as null when loaded.
 */
const ADDED_FIELDS: Partial<Record<EntityName, Record<string, null>>> = {
  product: { kind: null, kindSource: null, categorySource: null, suggestedMin: null },
};

export function upgradeStoredRow(entity: EntityName, row: unknown): unknown {
  const added = ADDED_FIELDS[entity];
  return added ? { ...added, ...(row as object) } : row;
}
type ReadonlyRowMaps = StoreSnapshot['rows'];

/** Membership problems the UI must prompt about (02 §9 cases 15 and 26). */
export type HouseholdNotice = 'not_member' | 'household_deleted' | null;

/** The contract snapshot plus what the screens need besides rows. */
export interface CellierSnapshot extends StoreSnapshot {
  userId: string | null;
  /** alias id → canonical id (add-versus-add merges), for routes holding an old id. */
  aliases: ReadonlyMap<string, string>;
  /** Local conflict notes (Activité), oldest first. */
  activity: ReadonlyArray<ActivityEntry>;
  notice: HouseholdNotice;
  /** Keys (`entity/id`) touched by an overlay entry: rows with changes not yet confirmed. */
  pendingKeys: ReadonlySet<EntityKey>;
  /** Milliseconds between the device clock and the server (02 §9 case 20). */
  clockSkewMs: number;
}

export interface CellierStore extends SyncStore {
  getSnapshot(): CellierSnapshot;
  setUser(userId: string | null): void;
  /** Entries removed from the outbox (pruned, discarded, cancelled). */
  removeEntries(ids: MutationId[]): void;
  setActivity(entries: ActivityEntry[]): void;
  addActivity(entries: ActivityEntry[]): void;
  setNotice(notice: HouseholdNotice): void;
  setClockSkew(ms: number): void;
  /** Runs `fn` and publishes a single snapshot at the end. */
  batch<T>(fn: () => T): T;
  /** Read access to the current view, for validation and natural-key lookups. */
  reader(): ReducerDraft;
  entry(id: MutationId): OutboxEntry | undefined;
}

const emptyMaps = (): RowMaps => ({
  household: new Map(),
  member: new Map(),
  pantry: new Map(),
  category: new Map(),
  product: new Map(),
  stock: new Map(),
  movement: new Map(),
  grocery: new Map(),
  overwrite: new Map(),
});

const BOOTING: SyncStatus = { kind: 'booting' };

/** Same keys and same primitive values (rows are flat JSON objects). */
function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) {
    const va = (a as Record<string, unknown>)[k];
    const vb = (b as Record<string, unknown>)[k];
    if (va !== vb && !(typeof va === 'object' && JSON.stringify(va) === JSON.stringify(vb))) return false;
  }
  return true;
}

/** A create acknowledged as merged into another row: its optimistic row must leave the view at once. */
function isMergedCreate(e: OutboxEntry): boolean {
  if (e.state !== 'acked' || !e.result?.data) return false;
  const data = e.result.data as Partial<CreateResultData>;
  return data.merged === true;
}

export function createSyncStore(): CellierStore {
  let base: RowMaps = emptyMaps();
  let view: RowMaps = emptyMaps();
  let householdId: HouseholdId | null = null;
  let userId: string | null = null;
  let cursor = 0;
  let status: SyncStatus = BOOTING;
  let aliases = new Map<string, string>();
  let activity: ActivityEntry[] = [];
  let notice: HouseholdNotice = null;
  let clockSkewMs = 0;
  const entries = new Map<MutationId, OutboxEntry>();
  const touchCache = new Map<MutationId, EntityKey[]>();

  let overlay: OutboxEntry[] = [];
  let attention: OutboxEntry[] = [];
  let pendingKeys: ReadonlySet<EntityKey> = new Set();
  let pendingKeysOf: readonly OutboxEntry[] = overlay;
  let snapshot: CellierSnapshot = buildSnapshot(0);
  const listeners = new Set<() => void>();
  let batchDepth = 0;
  let dirty = false;

  function buildSnapshot(version: number): CellierSnapshot {
    return {
      version,
      householdId,
      rows: view as unknown as ReadonlyRowMaps,
      overlay,
      attention,
      cursor,
      status,
      userId,
      aliases,
      activity,
      notice,
      pendingKeys,
      clockSkewMs,
    };
  }

  function commit(): void {
    if (batchDepth > 0) {
      dirty = true;
      return;
    }
    dirty = false;
    if (pendingKeysOf !== overlay) {
      pendingKeysOf = overlay;
      const keys = new Set<EntityKey>();
      for (const e of overlay) for (const k of touchCache.get(e.id) ?? []) keys.add(k);
      pendingKeys = keys;
    }
    snapshot = buildSnapshot(snapshot.version + 1);
    for (const l of [...listeners]) l();
  }

  function inOverlay(e: OutboxEntry): boolean {
    if (e.state === 'pending' || e.state === 'inflight') return true;
    return e.state === 'acked' && (e.ackedAtSyncId ?? 0) > cursor && !isMergedCreate(e);
  }

  function refreshLists(): void {
    const all = [...entries.values()].sort((a, b) => a.seq - b.seq);
    const nextOverlay = all.filter(inOverlay);
    const nextAttention = all.filter((e) => e.state === 'attention' || e.state === 'quarantined');
    if (!sameEntries(overlay, nextOverlay)) overlay = nextOverlay;
    if (!sameEntries(attention, nextAttention)) attention = nextAttention;
  }

  function sameEntries(a: readonly OutboxEntry[], b: readonly OutboxEntry[]): boolean {
    return a.length === b.length && a.every((e, i) => e === b[i]);
  }

  function readerOver(maps: RowMaps): ReducerDraft {
    return {
      get householdId() {
        return householdId as HouseholdId;
      },
      get userId() {
        return userId ?? '';
      },
      get: (entity, id) => maps[entity].get(id) as never,
      values: (entity) => maps[entity].values() as never,
      put() {
        throw new Error('read-only view');
      },
      delete() {
        throw new Error('read-only view');
      },
    };
  }

  function touchContext(e: OutboxEntry, over: ReducerDraft): TouchContext {
    return {
      mutationId: e.id,
      householdId: over.householdId,
      userId: over.userId,
      get: over.get,
      values: over.values,
    };
  }

  function touchesFor(e: OutboxEntry, over: ReducerDraft): EntityKey[] {
    let keys = touchCache.get(e.id);
    if (!keys) {
      keys = touchesOf(e.envelope, touchContext(e, over));
      touchCache.set(e.id, keys);
    }
    return keys;
  }

  function safeApply(draft: ReducerDraft, e: OutboxEntry): void {
    try {
      applyEnvelope(draft, e.envelope);
    } catch (error) {
      // A reducer bug must not take the store down; the server result will correct the view.
      console.error('[sync] reducer failed', e.envelope.name, error);
    }
  }

  /**
   * Full refold: view = base + every overlay entry in seq order. Used when the base or the overlay
   * membership changes (pull, ack, discard). Rows equal to the current view row keep their identity,
   * and so do maps whose rows are all unchanged.
   */
  function rebuildAll(): void {
    const next = emptyMaps();
    for (const entity of ENTITY_NAMES) {
      for (const [id, row] of base[entity]) (next[entity] as Map<string, unknown>).set(id, row);
    }
    const draft: ReducerDraft = {
      ...readerOver(next),
      put: (entity, id, row) => {
        (next[entity] as Map<string, unknown>).set(id, row);
      },
      delete: (entity, id) => {
        next[entity].delete(id);
      },
    };
    for (const e of overlay) {
      touchesFor(e, draft);
      safeApply(draft, e);
    }
    const merged = { ...view } as Record<EntityName, unknown>;
    let changed = false;
    for (const entity of ENTITY_NAMES) {
      const before = view[entity] as Map<string, unknown>;
      const after = next[entity] as Map<string, unknown>;
      let same = before.size === after.size;
      for (const [id, row] of after) {
        const old = before.get(id);
        if (old === row) continue;
        if (old !== undefined && shallowEqual(old, row)) after.set(id, old);
        else same = false;
      }
      if (!same) {
        merged[entity] = after;
        changed = true;
      }
    }
    if (changed) view = merged as RowMaps;
  }

  /**
   * Incremental path for a new local mutation: it is the newest in seq order, so applying it on top
   * of the current view is exactly the fold. Only the maps it writes are copied.
   */
  function applyOnTop(e: OutboxEntry): void {
    const copies = new Map<EntityName, Map<string, unknown>>();
    const mapOf = (entity: EntityName) => (copies.get(entity) ?? view[entity]) as Map<string, unknown>;
    const writable = (entity: EntityName) => {
      let m = copies.get(entity);
      if (!m) {
        m = new Map(view[entity] as Map<string, unknown>);
        copies.set(entity, m);
      }
      return m;
    };
    const draft: ReducerDraft = {
      get householdId() {
        return householdId as HouseholdId;
      },
      get userId() {
        return userId ?? '';
      },
      get: (entity, id) => mapOf(entity).get(id) as never,
      values: (entity) => mapOf(entity).values() as never,
      put: (entity, id, row) => {
        writable(entity).set(id, row);
      },
      delete: (entity, id) => {
        if (mapOf(entity).has(id)) writable(entity).delete(id);
      },
    };
    touchesFor(e, readerOver(view));
    safeApply(draft, e);
    if (copies.size === 0) return;
    const next = { ...view } as Record<EntityName, unknown>;
    for (const [entity, map] of copies) next[entity] = map;
    view = next as RowMaps;
  }

  const store: CellierStore = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    hydrate(id, rows: StoredRow[], outbox, cursorValue) {
      householdId = id;
      cursor = cursorValue;
      base = emptyMaps();
      for (const r of rows) (base[r.entity] as Map<string, unknown>).set(r.id, upgradeStoredRow(r.entity, r.row));
      entries.clear();
      touchCache.clear();
      for (const e of outbox) entries.set(e.id, e);
      notice = null;
      refreshLists();
      view = emptyMaps();
      rebuildAll();
      commit();
    },

    applyPage(page: PullResponse) {
      if (page.status !== 'ok') return;
      if (page.mode === 'snapshot') {
        base = emptyMaps();
        for (const entity of ENTITY_NAMES) {
          for (const row of page.upserts[entity] ?? []) {
            (base[entity] as Map<string, unknown>).set(rowIdOf(entity, row), row);
          }
        }
        cursor = page.toSyncId;
        refreshLists();
        rebuildAll();
        commit();
        return;
      }
      for (const entity of ENTITY_NAMES) {
        for (const row of page.upserts[entity] ?? []) {
          (base[entity] as Map<string, unknown>).set(rowIdOf(entity, row), row);
        }
      }
      for (const d of page.deletes) base[d.entity].delete(d.id);
      cursor = page.toSyncId;
      refreshLists();
      rebuildAll();
      commit();
    },

    applyLocal(entry) {
      entries.set(entry.id, entry);
      refreshLists();
      if (inOverlay(entry)) applyOnTop(entry);
      commit();
    },

    updateEntries(list) {
      let refold = false;
      for (const e of list) {
        const prev = entries.get(e.id);
        const wasIn = prev ? inOverlay(prev) : false;
        const envelopeChanged = prev !== undefined && prev.envelope !== e.envelope;
        if (envelopeChanged) touchCache.delete(e.id);
        if (wasIn !== inOverlay(e) || (envelopeChanged && wasIn)) refold = true;
        entries.set(e.id, e);
      }
      refreshLists();
      if (refold) rebuildAll();
      commit();
    },

    removeEntries(ids) {
      let refold = false;
      for (const id of ids) {
        const e = entries.get(id);
        if (!e) continue;
        if (inOverlay(e)) refold = true;
        entries.delete(id);
        touchCache.delete(id);
      }
      refreshLists();
      if (refold) rebuildAll();
      commit();
    },

    remap(map) {
      for (const [alias, canonical] of Object.entries(map)) aliases.set(alias, canonical);
      aliases = new Map(aliases);
      const record = Object.fromEntries(aliases);
      for (const [id, e] of entries) {
        if (e.state === 'acked') continue;
        const envelope = rewriteIds(e.envelope, record);
        if (JSON.stringify(envelope) !== JSON.stringify(e.envelope)) entries.set(id, { ...e, envelope });
      }
      touchCache.clear();
      refreshLists();
      rebuildAll();
      commit();
    },

    setStatus(next) {
      if (JSON.stringify(next) === JSON.stringify(status)) return;
      status = next;
      commit();
    },

    reset() {
      base = emptyMaps();
      view = emptyMaps();
      householdId = null;
      cursor = 0;
      status = BOOTING;
      aliases = new Map();
      activity = [];
      notice = null;
      entries.clear();
      touchCache.clear();
      overlay = [];
      attention = [];
      commit();
    },

    setUser(id) {
      if (userId === id) return;
      userId = id;
      commit();
    },
    setActivity(list) {
      activity = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      commit();
    },
    addActivity(list) {
      if (list.length === 0) return;
      const byId = new Map(activity.map((a) => [a.id, a]));
      for (const a of list) byId.set(a.id, a);
      store.setActivity([...byId.values()]);
    },
    setNotice(next) {
      if (notice === next) return;
      notice = next;
      commit();
    },
    setClockSkew(ms) {
      if (Math.abs(ms - clockSkewMs) < 1000) return;
      clockSkewMs = ms;
      commit();
    },
    batch(fn) {
      batchDepth += 1;
      try {
        return fn();
      } finally {
        batchDepth -= 1;
        if (batchDepth === 0 && dirty) commit();
      }
    },
    reader: () => readerOver(view),
    entry: (id) => entries.get(id),
  };

  return store;
}

/** Last time the store reached the server (from the status). */
export function lastSyncedAt(snapshot: StoreSnapshot): IsoDateTime | null {
  return snapshot.status.kind === 'idle' ? snapshot.status.lastSyncedAt : null;
}
