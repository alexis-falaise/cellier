/**
 * Outbox (02 §6, §7): the device's queued mutations, in memory for the active household and mirrored
 * in IndexedDB. It owns entry state transitions and tells the store which entries changed.
 */
import type {
  AnyMutationEnvelope,
  ApplyMutationsResponse,
  CreateResultData,
  HouseholdId,
  IsoDateTime,
  MutationArgs,
  MutationId,
  MutationName,
  MutationResult,
  StockResultData,
  UpdateResultData,
} from '@/domain/types';
import type { CellierDatabase } from '@/shared/db/cellierDb';
import type { ActivityEntry, AttentionReason, MetaDevice, Outbox, OutboxEntry } from './contract';
import type { CellierStore } from './store';
import { rewriteIds } from './util';

export const MAX_BATCH = 50;
/** Stay well under the server's 256 KB body limit. */
const MAX_BATCH_BYTES = 200_000;

/** Outbox record as stored: the contract entry plus the quantity the view showed before a recount. */
export interface LocalOutboxEntry extends OutboxEntry {
  /** stock.recount: the predicted quantity when the user counted (02 §9 case 4). */
  predictedQuantity?: number;
}

export interface OutboxDeps {
  db: CellierDatabase;
  store: CellierStore;
  now?: () => number;
  uuid?: () => string;
  /** Re-enqueues a mutation with a fresh envelope (the engine's `mutate`). */
  enqueue: <N extends MutationName>(name: N, args: MutationArgs[N]) => MutationId;
}

export interface SyncOutbox extends Outbox {
  load(householdId: HouseholdId, entries: OutboxEntry[]): void;
  /** Adds a new entry (already applied to the view by the caller) and persists it with the device meta. */
  add(entry: LocalOutboxEntry, device: MetaDevice): Promise<void>;
  get(id: MutationId): LocalOutboxEntry | undefined;
  all(): LocalOutboxEntry[];
  /** Removes a pending entry that was never sent (undo before flush). Returns false if it was sent. */
  cancel(id: MutationId): Promise<boolean>;
  /** Discards every quarantined entry of the household. */
  discardQuarantined(): Promise<void>;
  /** Resolves once every enqueue write has committed. */
  idle(): Promise<void>;
  clear(): void;
}

const CREATE_ID_ARG: Partial<Record<MutationName, string>> = {
  'pantry.create': 'pantryId',
  'category.create': 'categoryId',
  'product.create': 'productId',
  'grocery.add': 'groceryId',
};

/** Row id a create mutation names (its natural client id), or null. */
export function createdRowId(envelope: AnyMutationEnvelope): string | null {
  const key = CREATE_ID_ARG[envelope.name];
  return key ? String((envelope.args as Record<string, unknown>)[key]) : null;
}

const UPDATE_NAMES = new Set<MutationName>(['pantry.update', 'category.update', 'product.update', 'grocery.update']);

function productIdOf(envelope: AnyMutationEnvelope): string | null {
  const args = envelope.args as Record<string, unknown>;
  return typeof args.productId === 'string' ? args.productId : null;
}

export function createOutbox(deps: OutboxDeps): SyncOutbox {
  const { db, store } = deps;
  const now = deps.now ?? Date.now;
  const uuid = deps.uuid ?? (() => crypto.randomUUID());
  let householdId: HouseholdId | null = null;
  const entries = new Map<MutationId, LocalOutboxEntry>();
  /** Enqueue writes not yet committed; the flusher never sends those (02 §6.2 step 4). */
  const uncommitted = new Map<MutationId, Promise<void>>();

  const sorted = () => [...entries.values()].sort((a, b) => a.seq - b.seq);
  const iso = (): IsoDateTime => new Date(now()).toISOString();

  async function persist(changed: LocalOutboxEntry[]): Promise<void> {
    if (changed.length === 0) return;
    for (const e of changed) entries.set(e.id, e);
    store.updateEntries(changed);
    await db.updateOutbox(changed);
  }

  async function remove(ids: MutationId[]): Promise<void> {
    if (ids.length === 0) return;
    for (const id of ids) entries.delete(id);
    store.removeEntries(ids);
    // Delete after any in-progress enqueue write, or that write would resurrect the record.
    await Promise.allSettled(ids.map((id) => uncommitted.get(id)));
    await db.deleteOutbox(ids);
  }

  /** Every entry that depends, directly or transitively, on one of `roots`. */
  function dependantsOf(roots: Set<MutationId>): LocalOutboxEntry[] {
    const found: LocalOutboxEntry[] = [];
    const failed = new Set(roots);
    for (const e of sorted()) {
      // A failed root that itself depends on another failed root is reported as a dependant.
      if (e.dependsOn.some((d) => failed.has(d) && d !== e.id)) {
        failed.add(e.id);
        found.push(e);
      }
    }
    return found;
  }

  function productName(envelope: AnyMutationEnvelope): string {
    const id = productIdOf(envelope);
    return (id && store.reader().get('product', id)?.name) || '';
  }

  function activityFor(entry: LocalOutboxEntry, result: MutationResult): ActivityEntry[] {
    const env = entry.envelope;
    const make = (
      kind: ActivityEntry['kind'],
      messageKey: string,
      params: Record<string, string | number>,
      lostValues?: Record<string, unknown>,
    ): ActivityEntry => ({
      id: `${entry.id}:${kind}`,
      householdId: entry.householdId,
      createdAt: iso(),
      mutationId: entry.id,
      kind,
      messageKey,
      params,
      ...(lostValues ? { lostValues } : {}),
      read: false,
    });
    const out: ActivityEntry[] = [];
    const data = result.data;
    if (result.status === 'clamped' && data && 'applied' in data) {
      const d = data as StockResultData;
      const productId = productIdOf(env) ?? '';
      if (env.name === 'stock.transfer') {
        out.push(
          make('transfer_partial', 'toast.moveClamp', {
            productId,
            product: productName(env),
            pantryId: env.args.fromPantryId,
            requested: Math.abs(d.requested),
            applied: Math.abs(d.applied),
          }),
        );
      } else {
        out.push(
          make('clamped', 'activity.clamped', {
            productId,
            product: productName(env),
            requested: Math.abs(d.requested),
            applied: Math.abs(d.applied),
          }),
        );
      }
    }
    if (result.status === 'applied' && env.name === 'stock.recount' && data && 'applied' in data) {
      const d = data as StockResultData;
      const predicted = entry.predictedQuantity;
      if (predicted !== undefined && d.applied !== env.args.counted - predicted) {
        out.push(
          make('recount_adjusted', 'activity.recount', {
            productId: env.args.productId,
            product: productName(env),
            counted: env.args.counted,
            found: env.args.counted - d.applied,
          }),
        );
      }
    }
    if (result.status === 'applied' && data && 'restored' in data && (data as CreateResultData).restored) {
      out.push(
        make('restored', 'activity.restored', { rowId: (data as CreateResultData).canonicalId, mutation: env.name }),
      );
    }
    if (result.status === 'applied' && data && 'rejectedFields' in data) {
      const rejected = (data as UpdateResultData).rejectedFields;
      if (rejected.length > 0) {
        const source =
          env.name === 'household.rename'
            ? (env.args as Record<string, unknown>)
            : UPDATE_NAMES.has(env.name)
              ? ((env.args as { fields: Record<string, unknown> }).fields ?? {})
              : {};
        const lost: Record<string, unknown> = {};
        for (const f of rejected) lost[f] = source[f];
        out.push(make('rejected_fields', 'activity.edit', { mutation: env.name, fields: rejected.join(',') }, lost));
      }
    }
    return out;
  }

  const outbox: SyncOutbox = {
    load(id, list) {
      householdId = id;
      entries.clear();
      uncommitted.clear();
      // An entry left inflight by a killed app goes back to pending: the server dedupes by id.
      for (const e of list) entries.set(e.id, e.state === 'inflight' ? { ...e, state: 'pending' } : e);
    },

    add(entry, device) {
      entries.set(entry.id, entry);
      store.applyLocal(entry);
      const write = db.enqueue(entry, device).finally(() => {
        if (uncommitted.get(entry.id) === write) uncommitted.delete(entry.id);
      });
      uncommitted.set(entry.id, write);
      return write;
    },

    get: (id) => entries.get(id),
    all: sorted,

    nextBatch(hid) {
      if (hid !== householdId) return [];
      const failed = new Set(
        sorted()
          .filter((e) => e.state === 'attention' || e.state === 'quarantined')
          .map((e) => e.id),
      );
      const batch: LocalOutboxEntry[] = [];
      const blocked: LocalOutboxEntry[] = [];
      let bytes = 0;
      for (const e of sorted()) {
        if (e.state !== 'pending') continue;
        if (uncommitted.has(e.id)) break; // never send before the enqueue committed; keep seq order
        if (e.dependsOn.some((d) => failed.has(d))) {
          blocked.push({ ...e, state: 'attention', attentionReason: 'dependency_failed' });
          failed.add(e.id);
          continue;
        }
        const size = JSON.stringify(e.envelope).length;
        if (batch.length > 0 && bytes + size > MAX_BATCH_BYTES) break;
        batch.push(e);
        bytes += size;
        if (batch.length >= MAX_BATCH) break;
      }
      if (blocked.length > 0) void persist(blocked);
      return batch;
    },

    async markInflight(ids) {
      const changed: LocalOutboxEntry[] = [];
      for (const id of ids) {
        const e = entries.get(id);
        if (e && e.state === 'pending') changed.push({ ...e, state: 'inflight' });
      }
      await persist(changed);
    },

    async handleResponse(batch, response: ApplyMutationsResponse) {
      if (response.status === 'not_member') {
        await outbox.quarantineAll(batch[0]?.householdId ?? (householdId as HouseholdId));
        return [];
      }
      const results = new Map(response.results.map((r) => [r.id, r]));
      const changed = new Map<MutationId, LocalOutboxEntry>();
      const failedRoots = new Set<MutationId>();
      const activities: ActivityEntry[] = [];
      const aliases: Record<string, string> = {};
      let forbidden = false;

      for (const sent of batch) {
        const entry = entries.get(sent.id) ?? (sent as LocalOutboxEntry);
        const r = results.get(entry.id);
        if (!r || r.status === 'retry') {
          changed.set(entry.id, {
            ...entry,
            state: 'pending',
            attempts: entry.attempts + 1,
            ...(r ? { result: r } : {}),
          });
          continue;
        }
        switch (r.status) {
          case 'applied':
          case 'clamped': {
            changed.set(entry.id, { ...entry, state: 'acked', ackedAtSyncId: response.lastSyncId, result: r });
            const data = r.data as Partial<CreateResultData> | undefined;
            const rowId = createdRowId(entry.envelope);
            if (rowId && data?.canonicalId && data.canonicalId !== rowId) aliases[rowId] = data.canonicalId;
            activities.push(...activityFor(entry, r));
            break;
          }
          case 'gone':
          case 'invalid': {
            const reason: AttentionReason = r.status === 'gone' ? 'gone' : (r.code ?? 'validation');
            changed.set(entry.id, { ...entry, state: 'attention', attentionReason: reason, result: r });
            failedRoots.add(entry.id);
            break;
          }
          case 'forbidden':
            forbidden = true;
            break;
        }
      }

      for (const d of dependantsOf(failedRoots)) {
        if (d.state === 'acked' || d.state === 'quarantined') continue;
        const current = changed.get(d.id) ?? d;
        changed.set(d.id, { ...current, state: 'attention', attentionReason: 'dependency_failed' });
      }

      await persist([...changed.values()]);

      if (Object.keys(aliases).length > 0 && householdId) {
        const stored = await db.readAliases(householdId);
        const merged = { ...stored, ...aliases };
        const rewritten: LocalOutboxEntry[] = [];
        for (const e of entries.values()) {
          if (e.state === 'acked') continue;
          const envelope = rewriteIds(e.envelope, merged);
          const dependsOn = e.dependsOn;
          if (JSON.stringify(envelope) !== JSON.stringify(e.envelope)) rewritten.push({ ...e, envelope, dependsOn });
        }
        // One transaction would be ideal; the alias record is idempotent, so two writes are safe.
        await db.putMeta(`aliases:${householdId}`, merged);
        await persist(rewritten);
        store.remap(merged);
      }

      if (forbidden) await outbox.quarantineAll(householdId as HouseholdId);

      if (activities.length > 0) {
        await db.addActivity(activities);
        store.addActivity(activities);
      }
      return activities;
    },

    async requeue(ids) {
      const changed: LocalOutboxEntry[] = [];
      for (const id of ids) {
        const e = entries.get(id);
        if (e && e.state === 'inflight') changed.push({ ...e, state: 'pending', attempts: e.attempts + 1 });
      }
      await persist(changed);
    },

    async prune(hid, cursor) {
      if (hid !== householdId) return;
      const ids = sorted()
        .filter((e) => e.state === 'acked' && (e.ackedAtSyncId ?? 0) <= cursor)
        .map((e) => e.id);
      await remove(ids);
    },

    async quarantineAll(hid) {
      if (hid !== householdId) return;
      const changed = sorted()
        .filter((e) => e.state !== 'acked' && e.state !== 'quarantined')
        .map((e) => ({ ...e, state: 'quarantined' as const }));
      await persist(changed);
    },

    async discard(id) {
      const e = entries.get(id);
      if (!e) return;
      await remove([id, ...dependantsOf(new Set([id])).map((d) => d.id)]);
    },

    async retryWithRestore(id) {
      const e = entries.get(id);
      if (!e || (e.state !== 'attention' && e.state !== 'quarantined')) return;
      const group = [e, ...dependantsOf(new Set([id])).filter((d) => d.attentionReason === 'dependency_failed')];
      const view = store.reader();
      // Restore what was deleted under the mutation (02 §9 cases 9, 10, 14), then re-apply it.
      if (e.attentionReason === 'gone') {
        const args = e.envelope.args as Record<string, unknown>;
        const restore = (entity: 'pantry' | 'category' | 'product' | 'grocery', key: string) => {
          const rowId = args[key];
          if (typeof rowId !== 'string') return;
          const row = view.get(entity, rowId);
          if (row?.deletedAt) {
            if (entity === 'pantry') deps.enqueue('pantry.restore', { pantryId: row.id as never });
            else if (entity === 'category') deps.enqueue('category.restore', { categoryId: row.id as never });
            else if (entity === 'product') deps.enqueue('product.restore', { productId: row.id as never });
            else deps.enqueue('grocery.restore', { groceryId: row.id as never });
          }
        };
        restore('product', 'productId');
        restore('pantry', 'pantryId');
        restore('pantry', 'fromPantryId');
        restore('pantry', 'toPantryId');
        restore('category', 'categoryId');
        restore('grocery', 'groceryId');
      }
      await remove(group.map((g) => g.id));
      // A create is re-sent under a fresh row id: its old id is stored server-side with the failed result.
      const fresh: Record<string, string> = {};
      for (const g of group) {
        const oldId = createdRowId(g.envelope);
        if (oldId) fresh[oldId] = uuid();
      }
      for (const g of group) deps.enqueue(g.envelope.name, rewriteIds(g.envelope.args, fresh) as never);
    },

    pendingCount(hid) {
      if (hid !== householdId) return 0;
      let n = 0;
      for (const e of entries.values()) if (e.state === 'pending' || e.state === 'inflight') n += 1;
      return n;
    },

    async cancel(id) {
      const e = entries.get(id);
      if (e?.state !== 'pending') return false;
      if (dependantsOf(new Set([id])).length > 0) return false;
      await remove([id]);
      return true;
    },

    async discardQuarantined() {
      await remove(
        sorted()
          .filter((e) => e.state === 'quarantined')
          .map((e) => e.id),
      );
    },

    async idle() {
      while (uncommitted.size > 0) await Promise.allSettled([...uncommitted.values()]);
    },

    clear() {
      householdId = null;
      entries.clear();
      uncommitted.clear();
    },
  };
  return outbox;
}
