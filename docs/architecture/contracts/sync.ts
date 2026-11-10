/**
 * Cellier — client sync module interfaces (contract).
 *
 * Described in docs/architecture/02-sync-protocol.md §6–§8. Work package 2 (sync engine) implements
 * these in src/shared/db/ and src/shared/sync/; the reducers live in src/domain/mutations/.
 * Screens (packages 3–6) consume only `SyncEngine.mutate`, the React hooks and the selectors.
 *
 * Copied verbatim to src/shared/sync/contract.ts by package 0. Imports domain types from
 * src/domain/types.ts (copy of contracts/domain.ts).
 */
import type {
  AnyMutationEnvelope,
  ApplyMutationsResponse,
  DeviceId,
  EntityName,
  EntityRowMap,
  Hlc,
  HouseholdId,
  IsoDateTime,
  MutationArgs,
  MutationErrorCode,
  MutationId,
  MutationName,
  MutationResult,
  PullResponse,
  SyncStatus,
} from '@/domain/types';

// ---------------------------------------------------------------------------------------------
// IndexedDB (src/shared/db/) — database `cellier`, version 1
// ---------------------------------------------------------------------------------------------

/** `meta` store values, by key. */
export interface MetaDevice {
  deviceId: DeviceId;
  /** Next envelope seq; strictly increasing for the life of the install. */
  nextSeq: number;
  /** Last HLC issued or observed. */
  hlc: Hlc;
}
export interface MetaCursor {
  syncId: number;
  pulledAt: IsoDateTime;
}
/** Keys: 'device' | 'active-household' | `cursor:${householdId}` | `aliases:${householdId}`. */
export type MetaKey = 'device' | 'active-household' | `cursor:${string}` | `aliases:${string}`;

/** `rows` store record. Key: [householdId, entity, id]; index `household` on [householdId, entity]. */
export interface StoredRow<E extends EntityName = EntityName> {
  householdId: HouseholdId;
  entity: E;
  /** Row id; for stock `${pantryId}:${productId}`; for member the user id. */
  id: string;
  row: EntityRowMap[E];
}

/**
 * Outbox entry lifecycle:
 *   pending → inflight → acked (removed once cursor ≥ ackedAtSyncId)
 *                      → attention (gone / invalid / dependency_failed; user decides)
 *                      → pending (retry, transport failure, missing result)
 *   any → quarantined (forbidden / not_member / household deleted)
 */
export type OutboxState = 'pending' | 'inflight' | 'acked' | 'attention' | 'quarantined';

export type AttentionReason = 'gone' | 'dependency_failed' | MutationErrorCode;

/** `outbox` store record. Key: id; index `household-seq` on [householdId, seq]. */
export interface OutboxEntry {
  id: MutationId;
  householdId: HouseholdId;
  seq: number;
  envelope: AnyMutationEnvelope;
  state: OutboxState;
  /** Number of sends that ended without a terminal result. */
  attempts: number;
  createdAt: IsoDateTime;
  /** Set when state becomes 'acked'. */
  ackedAtSyncId?: number;
  /** Last result received (terminal or not). */
  result?: MutationResult;
  attentionReason?: AttentionReason;
  /** Ids of earlier creates this entry depends on (computed at enqueue). */
  dependsOn: MutationId[];
}

/** `activity` store record (local conflict notes shown in Activité). Key: id; index `household-created`. */
export interface ActivityEntry {
  id: string;
  householdId: HouseholdId;
  createdAt: IsoDateTime;
  mutationId: MutationId;
  kind: 'clamped' | 'recount_adjusted' | 'rejected_fields' | 'restored' | 'merged' | 'transfer_partial';
  /** i18n key and parameters; the text is rendered by the UI. */
  messageKey: string;
  params: Record<string, string | number>;
  /** For rejected_fields: the values this device lost, so "Rétablir" can re-send them. */
  lostValues?: Record<string, unknown>;
  read: boolean;
}

export interface CellierDb {
  getMeta<T>(key: MetaKey): Promise<T | undefined>;
  putMeta<T>(key: MetaKey, value: T): Promise<void>;
  readHousehold(householdId: HouseholdId): Promise<{ rows: StoredRow[]; outbox: OutboxEntry[] }>;
  /** One transaction: put rows, delete keys, store the cursor. */
  applyPull(householdId: HouseholdId, page: PullResponse): Promise<void>;
  /** One transaction: add the entry and persist meta.device. */
  enqueue(entry: OutboxEntry, device: MetaDevice): Promise<void>;
  updateOutbox(entries: OutboxEntry[]): Promise<void>;
  deleteOutbox(ids: MutationId[]): Promise<void>;
  addActivity(entries: ActivityEntry[]): Promise<void>;
  /** Removes every row, outbox entry, activity entry and meta key of the household. */
  dropHousehold(householdId: HouseholdId): Promise<void>;
}

// ---------------------------------------------------------------------------------------------
// HLC (src/shared/sync/hlc.ts)
// ---------------------------------------------------------------------------------------------

export interface HybridClock {
  /** Next timestamp: `${15-digit wall ms}.${6-digit counter}.${deviceId}`. */
  next(): Hlc;
  /** Merge a remote HLC or a server time (ISO) into the local clock. */
  observe(remote: Hlc | IsoDateTime): void;
  /** Milliseconds between the device clock and the last serverTime seen. */
  readonly skewMs: number;
}

// ---------------------------------------------------------------------------------------------
// Reducers (src/domain/mutations/) — pure, one per mutation name
// ---------------------------------------------------------------------------------------------

export type EntityKey = `${EntityName}/${string}`;

/** Read/write access to the view maps during a fold. Reducers never touch IndexedDB. */
export interface ViewDraft {
  get<E extends EntityName>(entity: E, id: string): EntityRowMap[E] | undefined;
  put<E extends EntityName>(entity: E, id: string, row: EntityRowMap[E]): void;
  delete(entity: EntityName, id: string): void;
  householdId: HouseholdId;
  /** The acting user, for movement actorId. */
  userId: string;
}

export interface MutationReducer<N extends MutationName> {
  /** Client-side checks mirroring the server's; returns an error code or null. */
  validate(args: MutationArgs[N], view: ViewDraft): MutationErrorCode | null;
  /** Keys whose view value this mutation changes (used to recompute only those). */
  touches(args: MutationArgs[N]): EntityKey[];
  /** Applies the predicted effect (clamp, LWW by HLC, natural-key merge) to the draft. */
  apply(draft: ViewDraft, envelope: Extract<AnyMutationEnvelope, { name: N }>): void;
}

export type ReducerTable = { [N in MutationName]: MutationReducer<N> };

// ---------------------------------------------------------------------------------------------
// Store (src/shared/sync/store.ts)
// ---------------------------------------------------------------------------------------------

/** Immutable snapshot; replaced on each commit. Unchanged maps keep their identity. */
export interface StoreSnapshot {
  version: number;
  householdId: HouseholdId | null;
  rows: { readonly [E in EntityName]: ReadonlyMap<string, EntityRowMap[E]> };
  /** Outbox entries in state pending/inflight/acked-but-not-pulled, by seq. */
  overlay: ReadonlyArray<OutboxEntry>;
  /** Entries in state attention or quarantined (the "À vérifier" list). */
  attention: ReadonlyArray<OutboxEntry>;
  cursor: number;
  status: SyncStatus;
}

export interface SyncStore {
  getSnapshot(): StoreSnapshot;
  subscribe(listener: () => void): () => void;
  hydrate(householdId: HouseholdId, rows: StoredRow[], outbox: OutboxEntry[], cursor: number): void;
  applyPage(page: PullResponse): void;
  /** Apply one new envelope to the view (optimistic). */
  applyLocal(entry: OutboxEntry): void;
  /** Update entry states after a flush; drops overlay entries no longer in it. */
  updateEntries(entries: OutboxEntry[]): void;
  /** Rewrite alias ids in the overlay after a merge. */
  remap(aliases: Record<string, string>): void;
  setStatus(status: SyncStatus): void;
  reset(): void;
}

// ---------------------------------------------------------------------------------------------
// Outbox (src/shared/sync/outbox.ts)
// ---------------------------------------------------------------------------------------------

export interface Outbox {
  /** Next batch: up to 50 pending entries in seq order, skipping blocked dependants. */
  nextBatch(householdId: HouseholdId): OutboxEntry[];
  markInflight(ids: MutationId[]): Promise<void>;
  /** Applies a response per 02 §7; returns the activity entries to record. */
  handleResponse(batch: OutboxEntry[], response: ApplyMutationsResponse): Promise<ActivityEntry[]>;
  /** Puts inflight entries back to pending after a transport failure. */
  requeue(ids: MutationId[]): Promise<void>;
  /** Drops acked entries with ackedAtSyncId ≤ cursor. */
  prune(householdId: HouseholdId, cursor: number): Promise<void>;
  quarantineAll(householdId: HouseholdId): Promise<void>;
  /** User actions on the "À vérifier" list. */
  discard(id: MutationId): Promise<void>;
  /** Re-enqueue with a fresh envelope (new id, seq, hlc), optionally preceded by a restore. */
  retryWithRestore(id: MutationId): Promise<void>;
  pendingCount(householdId: HouseholdId): number;
}

// ---------------------------------------------------------------------------------------------
// Engine (src/shared/sync/engine.ts)
// ---------------------------------------------------------------------------------------------

export type SyncTrigger =
  | 'mutate'
  | 'boot'
  | 'online'
  | 'visible'
  | 'hidden'
  | 'nudge'
  | 'channel_resubscribed'
  | 'timer'
  | 'token_refreshed'
  | 'manual';

export class MutationValidationError extends Error {
  constructor(
    readonly mutation: MutationName,
    readonly code: MutationErrorCode,
  ) {
    super(`${mutation}: ${code}`);
    this.name = 'MutationValidationError';
  }
}

export interface SyncEngine {
  /** Boot sequence 02 §6.4; resolves when the store is hydrated (before any network). */
  start(): Promise<void>;
  stop(): void;
  /**
   * Synchronous for the caller: validates, applies to the view, enqueues (IndexedDB commit happens
   * asynchronously), schedules a cycle. Throws MutationValidationError. Returns the mutation id,
   * which is also the movement id for stock mutations and the row id for creates.
   */
  mutate<N extends MutationName>(name: N, args: MutationArgs[N]): MutationId;
  /** Runs one cycle now (flush then pull) unless one is running. */
  sync(trigger: SyncTrigger): Promise<void>;
  /** Switch the active household (re-hydrate, rejoin the channel). */
  setActiveHousehold(householdId: HouseholdId | null): Promise<void>;
  /** Called after sign-out: closes the channel and clears every household. */
  clear(): Promise<void>;
  readonly store: SyncStore;
  readonly outbox: Outbox;
  readonly clock: HybridClock;
}

// ---------------------------------------------------------------------------------------------
// React bindings (src/shared/sync/react.ts)
// ---------------------------------------------------------------------------------------------

export interface SyncReactBindings {
  /** useSyncExternalStore over the snapshot; re-renders only when the selected value changes. */
  useStore<T>(selector: (s: StoreSnapshot) => T, isEqual?: (a: T, b: T) => boolean): T;
  useMutate(): SyncEngine['mutate'];
  useSyncStatus(): SyncStatus;
}
