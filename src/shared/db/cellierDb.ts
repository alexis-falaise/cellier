/**
 * IndexedDB layer (02 §6): database `cellier`, version 1.
 *
 * Stores: `meta` (out-of-line string keys), `rows` (base rows confirmed by the server, never the
 * optimistic view), `outbox`, `activity` (local conflict notes), `catalog` (owned by the catalogue
 * package; only created here so the schema has a single owner of the version number).
 */
import { type DBSchema, deleteDB, type IDBPDatabase, openDB } from 'idb';
import type { EntityName, HouseholdId, MutationId, PullResponse } from '@/domain/types';
import type { ActivityEntry, CellierDb, MetaDevice, MetaKey, OutboxEntry, StoredRow } from '@/shared/sync/contract';

export const DB_NAME = 'cellier';
export const DB_VERSION = 1;

/** Entity names stored in `rows`, in the order of `PullUpserts`. */
export const ENTITY_NAMES: readonly EntityName[] = [
  'household',
  'member',
  'pantry',
  'category',
  'product',
  'stock',
  'movement',
  'grocery',
  'overwrite',
];

interface CatalogRecord {
  gtin: string;
  usedAt: number;
  [key: string]: unknown;
}

interface CellierSchema extends DBSchema {
  meta: { key: string; value: unknown };
  rows: {
    key: [string, string, string];
    value: StoredRow;
    indexes: { household: [string, string] };
  };
  outbox: {
    key: string;
    value: OutboxEntry;
    indexes: { 'household-seq': [string, number] };
  };
  activity: {
    key: string;
    value: ActivityEntry;
    indexes: { 'household-created': [string, string] };
  };
  catalog: {
    key: string;
    value: CatalogRecord;
    indexes: { 'used-at': number };
  };
}

/** Row id of a pulled row, as used by the change log (02 §5, contract `StoredRow.id`). */
export function rowIdOf(entity: EntityName, row: object): string {
  const r = row as Record<string, unknown>;
  if (entity === 'stock') return `${String(r.pantryId)}:${String(r.productId)}`;
  if (entity === 'member') return String(r.userId);
  return String(r.id);
}

/** The contract interface plus the reads the engine needs at boot and for the Activité screen. */
export interface CellierDatabase extends CellierDb {
  readCursor(householdId: HouseholdId): Promise<number>;
  readAliases(householdId: HouseholdId): Promise<Record<string, string>>;
  listActivity(householdId: HouseholdId): Promise<ActivityEntry[]>;
  markActivityRead(ids: string[]): Promise<void>;
  /** Sign-out: every household, outbox and activity entry; keeps `meta.device` (seq stays monotonic). */
  clearAll(): Promise<void>;
  close(): void;
}

function householdRange(householdId: string): IDBKeyRange {
  return IDBKeyRange.bound([householdId, ''], [householdId, '￿']);
}
function seqRange(householdId: string): IDBKeyRange {
  return IDBKeyRange.bound([householdId, -Infinity], [householdId, Infinity]);
}

export async function openCellierDb(name: string = DB_NAME): Promise<CellierDatabase> {
  const db: IDBPDatabase<CellierSchema> = await openDB<CellierSchema>(name, DB_VERSION, {
    upgrade(database) {
      database.createObjectStore('meta');
      const rows = database.createObjectStore('rows', { keyPath: ['householdId', 'entity', 'id'] });
      rows.createIndex('household', ['householdId', 'entity']);
      const outbox = database.createObjectStore('outbox', { keyPath: 'id' });
      outbox.createIndex('household-seq', ['householdId', 'seq']);
      const activity = database.createObjectStore('activity', { keyPath: 'id' });
      activity.createIndex('household-created', ['householdId', 'createdAt']);
      const catalog = database.createObjectStore('catalog', { keyPath: 'gtin' });
      catalog.createIndex('used-at', 'usedAt');
    },
  });

  async function getMeta<T>(key: MetaKey): Promise<T | undefined> {
    return (await db.get('meta', key)) as T | undefined;
  }

  async function putMeta<T>(key: MetaKey, value: T): Promise<void> {
    await db.put('meta', value, key);
  }

  async function readHousehold(householdId: HouseholdId): Promise<{ rows: StoredRow[]; outbox: OutboxEntry[] }> {
    const tx = db.transaction(['rows', 'outbox'], 'readonly');
    const [rows, outbox] = await Promise.all([
      tx.objectStore('rows').index('household').getAll(householdRange(householdId)),
      tx.objectStore('outbox').index('household-seq').getAll(seqRange(householdId)),
      tx.done,
    ]);
    return { rows, outbox };
  }

  async function applyPull(householdId: HouseholdId, page: PullResponse): Promise<void> {
    const tx = db.transaction(['rows', 'meta'], 'readwrite');
    const rows = tx.objectStore('rows');
    if (page.mode === 'snapshot') {
      // Snapshot replaces every base row of the household.
      let cursor = await rows.index('household').openKeyCursor(householdRange(householdId));
      while (cursor) {
        await rows.delete(cursor.primaryKey);
        cursor = await cursor.continue();
      }
    }
    for (const entity of ENTITY_NAMES) {
      for (const row of page.upserts[entity] ?? []) {
        await rows.put({ householdId, entity, id: rowIdOf(entity, row), row } as StoredRow);
      }
    }
    for (const del of page.deletes) {
      await rows.delete([householdId, del.entity, del.id]);
    }
    await tx.objectStore('meta').put({ syncId: page.toSyncId, pulledAt: page.serverTime }, `cursor:${householdId}`);
    await tx.done;
  }

  async function enqueue(entry: OutboxEntry, device: MetaDevice): Promise<void> {
    const tx = db.transaction(['outbox', 'meta'], 'readwrite');
    await Promise.all([tx.objectStore('outbox').put(entry), tx.objectStore('meta').put(device, 'device'), tx.done]);
  }

  async function updateOutbox(entries: OutboxEntry[]): Promise<void> {
    if (entries.length === 0) return;
    const tx = db.transaction('outbox', 'readwrite');
    await Promise.all([...entries.map((e) => tx.store.put(e)), tx.done]);
  }

  async function deleteOutbox(ids: MutationId[]): Promise<void> {
    if (ids.length === 0) return;
    const tx = db.transaction('outbox', 'readwrite');
    await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
  }

  async function addActivity(entries: ActivityEntry[]): Promise<void> {
    if (entries.length === 0) return;
    const tx = db.transaction('activity', 'readwrite');
    await Promise.all([...entries.map((e) => tx.store.put(e)), tx.done]);
  }

  async function listActivity(householdId: HouseholdId): Promise<ActivityEntry[]> {
    return db.getAllFromIndex('activity', 'household-created', householdRange(householdId));
  }

  async function markActivityRead(ids: string[]): Promise<void> {
    const tx = db.transaction('activity', 'readwrite');
    for (const id of ids) {
      const entry = await tx.store.get(id);
      if (entry && !entry.read) await tx.store.put({ ...entry, read: true });
    }
    await tx.done;
  }

  async function dropHousehold(householdId: HouseholdId): Promise<void> {
    const tx = db.transaction(['rows', 'outbox', 'activity', 'meta'], 'readwrite');
    let rc = await tx.objectStore('rows').index('household').openKeyCursor(householdRange(householdId));
    while (rc) {
      await tx.objectStore('rows').delete(rc.primaryKey);
      rc = await rc.continue();
    }
    let oc = await tx.objectStore('outbox').index('household-seq').openKeyCursor(seqRange(householdId));
    while (oc) {
      await tx.objectStore('outbox').delete(oc.primaryKey);
      oc = await oc.continue();
    }
    let ac = await tx.objectStore('activity').index('household-created').openKeyCursor(householdRange(householdId));
    while (ac) {
      await tx.objectStore('activity').delete(ac.primaryKey);
      ac = await ac.continue();
    }
    const meta = tx.objectStore('meta');
    await meta.delete(`cursor:${householdId}`);
    await meta.delete(`aliases:${householdId}`);
    if ((await meta.get('active-household')) === householdId) await meta.delete('active-household');
    await tx.done;
  }

  async function clearAll(): Promise<void> {
    const tx = db.transaction(['rows', 'outbox', 'activity', 'meta'], 'readwrite');
    await tx.objectStore('rows').clear();
    await tx.objectStore('outbox').clear();
    await tx.objectStore('activity').clear();
    const meta = tx.objectStore('meta');
    let mc = await meta.openKeyCursor();
    while (mc) {
      if (mc.key !== 'device') await meta.delete(mc.key);
      mc = await mc.continue();
    }
    await tx.done;
  }

  return {
    getMeta,
    putMeta,
    readHousehold,
    applyPull,
    enqueue,
    updateOutbox,
    deleteOutbox,
    addActivity,
    dropHousehold,
    async readCursor(householdId) {
      return (await getMeta<{ syncId: number }>(`cursor:${householdId}`))?.syncId ?? 0;
    },
    async readAliases(householdId) {
      return (await getMeta<Record<string, string>>(`aliases:${householdId}`)) ?? {};
    },
    listActivity,
    markActivityRead,
    clearAll,
    close: () => db.close(),
  };
}

/** Test helper and "reset this device": deletes the whole database. */
export async function deleteCellierDb(name: string = DB_NAME): Promise<void> {
  await deleteDB(name);
}
