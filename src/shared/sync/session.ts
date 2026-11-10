/**
 * Session entry point for the app shell: one store for the whole app, one engine per signed-in user.
 *
 *   await startSync({ userId, householdId })   // after sign-in / at boot with a cached session
 *   await switchHousehold(otherId)             // household picker
 *   await signOutSync()                        // sign-out: clears IndexedDB (keeps the device id)
 *   stopSync()                                 // tear down without clearing (HMR, tests)
 */
import type { HouseholdId, MutationArgs, MutationId, MutationName } from '@/domain/types';
import { type CellierDatabase, openCellierDb } from '@/shared/db/cellierDb';
import { type CellierSyncEngine, createSyncEngine } from './engine';
import type { EngineEnvironment } from './environment';
import { type CellierStore, createSyncStore } from './store';
import type { SyncTransport } from './transport';

export interface StartSyncOptions {
  userId: string;
  /** Household to open. Omitted: the one stored on this device (`meta.active-household`), if any. */
  householdId?: HouseholdId | null;
  /** Defaults to the Supabase transport (loaded lazily). Tests pass a fake. */
  transport?: SyncTransport;
  environment?: EngineEnvironment;
  /** IndexedDB database name (tests). */
  dbName?: string;
}

const store: CellierStore = createSyncStore();
let engine: CellierSyncEngine | null = null;
let engineUserId: string | null = null;
let databases = new Map<string, Promise<CellierDatabase>>();
let starting: Promise<CellierSyncEngine> | null = null;
const engineListeners = new Set<() => void>();

function notifyEngine() {
  for (const l of [...engineListeners]) l();
}

function database(name = 'cellier'): Promise<CellierDatabase> {
  let db = databases.get(name);
  if (!db) {
    db = openCellierDb(name);
    databases.set(name, db);
  }
  return db;
}

/** The app-wide store (empty until `startSync`). */
export function getSyncStore(): CellierStore {
  return store;
}

export function getSyncEngine(): CellierSyncEngine | null {
  return engine;
}

export function requireSyncEngine(): CellierSyncEngine {
  if (!engine) throw new Error('Sync is not started; call startSync({ userId, householdId }) after sign-in.');
  return engine;
}

/** Subscribe to engine start/stop (for `useSyncEngine`). */
export function subscribeSyncEngine(listener: () => void): () => void {
  engineListeners.add(listener);
  return () => engineListeners.delete(listener);
}

/**
 * Boots sync for a signed-in user: opens IndexedDB, hydrates the store from it (resolves before any
 * network call), then syncs and joins Realtime in the background. Idempotent per user.
 */
export async function startSync(options: StartSyncOptions): Promise<CellierSyncEngine> {
  if (starting) await starting.catch(() => undefined);
  if (engine && engineUserId === options.userId) {
    if (options.householdId !== undefined && options.householdId !== engine.householdId) {
      await engine.setActiveHousehold(options.householdId);
    }
    return engine;
  }
  if (engine) stopSync();
  starting = (async () => {
    const [db, transport] = await Promise.all([
      database(options.dbName),
      options.transport ?? import('./supabaseTransport').then((m) => m.loadSupabaseTransport()),
    ]);
    const next = createSyncEngine({
      db,
      transport,
      userId: options.userId,
      store,
      ...(options.householdId !== undefined ? { householdId: options.householdId } : {}),
      ...(options.environment ? { environment: options.environment } : {}),
    });
    engine = next;
    engineUserId = options.userId;
    notifyEngine();
    await next.start();
    return next;
  })();
  try {
    return await starting;
  } finally {
    starting = null;
  }
}

/** Stops the engine and empties the store, keeping IndexedDB (another user may not sign in). */
export function stopSync(): void {
  engine?.stop();
  engine = null;
  engineUserId = null;
  store.reset();
  store.setUser(null);
  notifyEngine();
}

/** Switches the active household (household picker, accepted invite). */
export async function switchHousehold(householdId: HouseholdId | null): Promise<void> {
  await requireSyncEngine().setActiveHousehold(householdId);
}

/**
 * Deletes one household's local data from IndexedDB (base rows, outbox, activity notes, cursor,
 * aliases), after leaving, deleting or losing access to it. If it is the open household, the engine
 * closes it first (no household open afterwards). Other households and the device id are kept.
 */
export async function forgetHousehold(householdId: HouseholdId, options: { dbName?: string } = {}): Promise<void> {
  if (starting) await starting.catch(() => undefined);
  if (engine && engine.householdId === householdId) await engine.setActiveHousehold(null);
  await (await database(options.dbName)).dropHousehold(householdId);
}

/** Sign-out: closes the channel, clears every household from IndexedDB and memory. */
export async function signOutSync(options: { dbName?: string } = {}): Promise<void> {
  const current = engine;
  engine = null;
  engineUserId = null;
  if (current) await current.clear();
  else await (await database(options.dbName)).clearAll();
  store.reset();
  store.setUser(null);
  notifyEngine();
}

/** The household stored on this device, for routing at boot before any network (02 §6.4 step 2). */
export async function readActiveHouseholdId(options: { dbName?: string } = {}): Promise<HouseholdId | null> {
  return (await (await database(options.dbName)).getMeta<HouseholdId | null>('active-household')) ?? null;
}

/** `engine.mutate` of the current session (throws when sync is not started). */
export function mutate<N extends MutationName>(name: N, args: MutationArgs[N]): MutationId {
  return requireSyncEngine().mutate(name, args);
}

/** Test helper: forget open databases (after deleting them). */
export function resetSyncSessionForTests(): void {
  stopSync();
  for (const db of databases.values()) void db.then((d) => d.close());
  databases = new Map();
}
