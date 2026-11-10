# 14 - Linear's sync engine, and a small version for Cellier

Research date: 2026-11-10. Scope: how Linear's client sync works, how to build a small version on Supabase, and which state/sync libraries to use.

Confidence legend: items marked **UNVERIFIED** were not confirmed from a primary source during this research. Secondary sources are labelled as such.

---

## 0. Summary

- Linear is local-first: the client holds a local model graph and applies edits optimistically, then syncs in the background. The server totally orders changes with a monotonically increasing sync ID.
- The mechanisms below come mainly from the reverse-engineering write-up (wzhudev), which states it is not affiliated with Linear. Linear's own 2023 blog post is only a stub for the talk, and the talk transcripts were not accessible here.
- For Cellier (hundreds to a few thousand rows per household, Supabase free budget), a hand-rolled version is small: one change log, one `pull(since)` RPC, Broadcast as a nudge, a Zustand-style normalised store, and an IndexedDB outbox.
- **Recommendation:** hand-roll the sync layer, use Zustand (or a ~150-line `useSyncExternalStore` store) for state, Dexie or `idb` for IndexedDB, and Supabase Broadcast-from-DB for push. Revisit TanStack DB + Electric once TanStack DB's 1.0 status is confirmed.

---

## 1. How Linear's sync engine works (reverse-engineered)

Sources: the reverse-engineering write-up in the wzhudev repo ([github.com/wzhudev/reverse-linear-sync-engine](https://github.com/wzhudev/reverse-linear-sync-engine), SUMMARY.md chapters 1 to 5), Linear's talk page ([linear.app/blog/scaling-the-linear-sync-engine](https://linear.app/blog/scaling-the-linear-sync-engine), dated 2023-06-29 on the page), and Linear's read-path post ([linear.app/blog/rebuilding-delta-sync-read-path](https://linear.app/blog/rebuilding-delta-sync-read-path), which the fetch reported as dated 2026-08-18).

### 1.1 Object pool and model graph

```
          +-------------------- Object pool (Map<uuid, Model>) --------------------+
          |                                                                       |
  Issue(uuid A) --assignee(lazy ref)--> User(uuid U)                              |
     |  \--labels (reference collection)--> [Label L1, Label L2]                   |
     +--project(lazy ref)--> Project(uuid P)                                       |
          +------------------------------------------------------------------------+
                     ^ observable properties (MobX) -> React views re-render on change
```

- Entities are "models" with typed properties and references. Models are kept in one global object pool keyed by UUID, so there is one instance per entity.
- Observability uses MobX. Views react to property changes. The write-up says a `ModelRegistry` stores model metadata, populated by decorators.
- References can be lazy: the referenced model is hydrated only when the property is accessed. Back references and many-to-many arrays are also modelled.

### 1.2 Bootstrap (full versus partial)

- **Full bootstrap:** a `StoreManager` creates per-model stores (`FullStore` or `PartialStore`) and a `SyncActionStore`. A `Database` opens IndexedDB, runs migrations if the schema hash changed, and the server data is written to IndexedDB. Data needed immediately is loaded into memory, and a WebSocket is opened.
- **Partial bootstrap:** the write-up defines a `partial` load strategy in which a subset of instances is fetched on demand. It does not describe the full procedure. **UNVERIFIED** in detail.
- Sync groups: `subscribedSyncGroups` (user, teams, roles) determine which data the client may receive.

### 1.3 IndexedDB layout (as described)

- One database per logged-in workspace.
- Workspace metadata: `lastSyncId`, `firstSyncId`, `subscribedSyncGroups`, `__schemaHash`.
- A `__transactions` table caching pending transactions.
- A sync-action store and per-model object stores. The write-up does not list every store. **UNVERIFIED** for the rest.

### 1.4 `lastSyncId` and delta packets

- `lastSyncId` is a workspace-wide, monotonically increasing integer. It increments each time the server successfully applies a transaction. Transactions are totally ordered. The write-up says this is closer to operational transformation than to CRDTs.
- `firstSyncId` is the `lastSyncId` at full bootstrap. Incremental sync starts from there.
- Delta packets contain sync actions, each with its own sync ID. The client uses sync IDs to detect gaps.
- The 2026 read-path post says each sync action has an ordered ID, the model, the change type, routing metadata and data. It describes an immutable, ordered per-workspace action log. Deletions are sync actions (for example "deleting a comment"). Tombstone storage is not described. **UNVERIFIED** whether a separate tombstone table exists.
- Catch-up: the client sends a checkpoint (last applied ID). The server returns only later actions. Reads are filtered by sync group and subscription, then enriched with full payloads.

### 1.5 Sync action types

The write-up says delta packets can differ from the original transaction, because the server may apply side effects such as history entries. It names insert, update, delete and archive in the Linear product, but the write-up does not list them as a fixed enum. **UNVERIFIED** as a complete list.

### 1.6 Transaction queue

1. A property write updates the in-memory model immediately, recording property name and previous value (optimistic apply).
2. `save()` creates an `UpdateTransaction`, adds it to a request queue and caches it in `__transactions`.
3. A `TransactionQueue` sends transactions in batches.
4. A batch is removed from the cache once the backend has processed it.
5. A transaction completes when the matching `lastSyncId` arrives in a delta packet.

The write-up says transactions can be reverted on the client when the server rejects them, but gives no step-by-step procedure. **UNVERIFIED**: rebase of local pending changes over incoming deltas is not described in the write-up that was read. Linear's own talk is the likely source.

### 1.7 WebSocket delivery and reconnect

- The client receives delta packets over a WebSocket.
- On receipt: update subscription membership, load dependencies, write to IndexedDB, apply sync actions to storage then memory, update `lastSyncId`.
- On reconnect: cached transactions are resent. The write-up does not describe a separate catch-up endpoint beyond the sync-ID range read described in 1.4.

### 1.8 Undo

The write-up says transactions support undo, redo and client-side reversal. Exact mechanics are in its chapter 5, which was not fully read. **UNVERIFIED**. The safe model (used below) is that undo creates new inverse transactions from recorded `prev` values rather than rewinding history.

### 1.9 Provenance caveats

- The write-up's author states they are not affiliated with Linear and did not consult them. They say there may be inaccuracies. A quote attributed to Linear's CTO praising its accuracy appears in the summary, **UNVERIFIED**.
- Talk details (Local-First Conf 2024, the 2023 React Helsinki talk, and the sequel) were only available through third-party summaries ([localfirst.fm episode 15 transcript](https://localfirst-fm.vercel.app/15/transcript)). No transcript of the sync-ID or rebase material was read.

---

## 2. Diagrams

### 2.1 Write path (optimistic)

```
UI event
  -> store.optimistic(tx)          (view updates now)
       -> outbox.enqueue(tx)       (IndexedDB, durable)
            -> flush(): POST rpc/apply_tx {tx_id, ops}   (idempotent on tx_id)
                 server: BEGIN; check idempotency; apply ops;
                         insert change_log rows with next household sync_id; COMMIT
                 <- {status: 'ok', sync_id} | {status: 'rejected', reason}
            ok:       outbox.ack(tx_id); overlay drops tx; base updated on pull
            rejected: outbox.markRejected; overlay drops tx; toast + undo entry
```

### 2.2 Read path (pull and nudge)

```
Server commit -> trigger writes change_log(sync_id=N) -> trigger calls realtime.broadcast_changes
                                                       topic "household:<id>" payload {sync_id: N}
Client (subscribed)  -> on nudge: pull(since = lastSyncId)
Client startup       -> render from IndexedDB -> pull(since) -> flush outbox -> subscribe
```

### 2.3 Entity view = base + overlay

```
server base (from pull)   : Map<id, Row>          persisted in IDB
pending overlay (outbox)  : ordered ops per id     persisted in IDB
view(id) = apply(overlay ops for id, base[id])     recomputed on change, memoised per id
```

---

## 3. Translation to Cellier (Supabase)

### 3.1 Server schema

```sql
-- every synced table
alter table items add column updated_at timestamptz not null default now();
alter table items add column deleted_at timestamptz;          -- soft delete = tombstone in the row too

-- per-household counter: row lock serialises writers per household,
-- which avoids the "sequence committed out of order" gap problem
create table household_sync (
  household_id uuid primary key references households(id),
  last_sync_id bigint not null default 0
);

create table change_log (
  household_id uuid not null,
  sync_id      bigint not null,
  table_name   text not null,
  row_id       uuid not null,
  op           text not null check (op in ('upsert','delete')),
  row          jsonb,                       -- null for delete (tombstone)
  tx_id        uuid,
  created_at   timestamptz not null default now(),
  primary key (household_id, sync_id)
);

create table applied_tx (                   -- idempotency
  household_id uuid not null,
  tx_id        uuid not null,
  sync_id      bigint,
  result       jsonb not null,
  primary key (household_id, tx_id)
);

-- trigger (sketch) on each synced table
create or replace function log_change() returns trigger language plpgsql security definer as $$
declare hh uuid := coalesce(new.household_id, old.household_id); n bigint;
begin
  update household_sync set last_sync_id = last_sync_id + 1
    where household_id = hh returning last_sync_id into n;
  insert into change_log(household_id, sync_id, table_name, row_id, op, row, tx_id)
    values (hh, n, tg_table_name, coalesce(new.id, old.id),
            case when tg_op = 'DELETE' then 'delete' else 'upsert' end,
            case when tg_op = 'DELETE' then null else to_jsonb(new) end,
            nullif(current_setting('app.tx_id', true), '')::uuid);
  perform realtime.broadcast_changes('household:' || hh, 'sync', 'nudge',
          tg_table_name, tg_op, new, old);      -- see 3.4 on payload
  return coalesce(new, old);
end $$;
```

Notes:

- The per-household counter update takes a row lock, so two transactions in one household cannot commit sync IDs out of order. A global `bigserial` would let a reader see N+2 committed before N+1, and a client with `since=N+2` would miss N+1. This is the main correctness reason for the counter row. Linear's write-up describes a single server-ordered sequence, which is the same idea.
- `pull` compacts per row: only the latest change per `(table, row_id)` in the batch is needed for the client.
- Retention: keep `change_log` for e.g. 30 days. If `since < min(sync_id)`, return `resync_required` and the client runs a snapshot.

### 3.2 `pull(since)` RPC

```ts
// rpc: pull_changes(p_household uuid, p_since bigint, p_limit int default 500)
interface PullRequest { householdId: string; since: number; limit?: number }
interface PullResponse {
  mode: 'delta' | 'resync_required';
  changes: Array<{ syncId: number; table: TableName; rowId: string; op: 'upsert' | 'delete'; row: Row | null }>;
  lastSyncId: number;       // household head at response time
  hasMore: boolean;         // client loops until false
}
```

- Access: RLS-free RPC with `security definer` that checks `is_household_member(p_household)` first.
- Tombstones: `op='delete'` with `row=null`; the client sets `deletedAt` and keeps the id until its outbox is empty (then purge after N days).

### 3.3 Snapshot (bootstrap)

`snapshot(household)` returns `{ lastSyncId, rows: {items: [...], ...} }` in one transaction (`isolation repeatable read`), so `lastSyncId` matches the rows.

### 3.4 Push channel

Recommended: **Broadcast from the database**, not `postgres_changes`. The Supabase docs say Broadcast is "the recommended method for scalability and security" and Postgres Changes "does not scale as well" ([supabase.com/docs/guides/realtime/subscribing-to-database-changes](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes), fetched 2026-11-10). Broadcast needs a private-channel RLS policy on `realtime.messages`.

Design choice: send only a nudge `{sync_id}`, and have the client pull the data. This keeps payloads tiny, avoids sending row data through Realtime, and reuses one code path for startup, reconnect and live updates. The trigger sketch above sends row data for brevity; in production send `{household_id, sync_id}` only. Payload and message limits were not stated on the docs page read. **UNVERIFIED** against current quotas.

### 3.5 Client-side TypeScript sketches

```ts
type TableName = 'items' | 'locations' | 'movements';          // Cellier tables
type Row<T extends TableName = TableName> = { id: string; updatedAt: string; deletedAt: string | null } & Record<string, unknown>;

// Normalised store: one map per table, selectors read from it
interface StoreState {
  meta: { householdId: string; lastSyncId: number; status: 'booting' | 'ready' | 'offline' };
  base: { [T in TableName]: Map<string, Row<T>> };          // last server-confirmed rows
  overlay: Map<string, PendingOp[]>;                         // key `${table}:${id}` -> ops not yet confirmed
  indexes: DerivedIndexes;                                   // e.g. itemsByLocation, recomputed incrementally
}

interface Store {
  getState(): StoreState;
  select<S>(selector: (s: StoreState) => S): S;              // used via useSyncExternalStore
  subscribe(listener: () => void): () => void;
  view<T extends TableName>(table: T, id: string): Row<T> | undefined; // base + overlay, memoised
  applyDelta(changes: PullResponse['changes'], lastSyncId: number): void;
  applyOptimistic(tx: Transaction): void;
  dropOverlay(txId: string): void;                            // on ack or reject
}

type Op =
  | { kind: 'insert'; table: TableName; row: Row }
  | { kind: 'update'; table: TableName; id: string; patch: Partial<Row>; prev: Partial<Row> }
  | { kind: 'delete'; table: TableName; id: string; prev: Row };

type PendingOp = Op & { txId: string };

interface Transaction {
  id: string;                    // UUID v4, idempotency key, reused on every retry
  householdId: string;
  createdAt: string;
  ops: Op[];
  attempts: number;
  status: 'pending' | 'inflight' | 'acked' | 'rejected';
  rejectReason?: string;
  inverse?: Op[];                // for undo: built from prev values, submitted as a new tx
}

interface Outbox {                 // IndexedDB store "outbox", key = tx.id, ordered by createdAt
  enqueue(tx: Transaction): Promise<void>;
  peekBatch(max: number): Promise<Transaction[]>;
  ack(txIds: string[]): Promise<void>;
  reject(txId: string, reason: string): Promise<void>;
  pending(): Promise<Transaction[]>;
}

interface SyncClient {
  boot(): Promise<void>;         // IDB -> store (render), then pull, flush, subscribe
  pull(): Promise<void>;         // loops while hasMore; handles resync_required via snapshot()
  flush(): Promise<void>;        // peekBatch -> rpc apply_tx -> ack/reject; exp. backoff on network error
  onNudge(syncId: number): void; // Realtime: pull if syncId > lastSyncId
  dispose(): void;
}
```

Notes on the sketches:

- **Rebase:** no rewriting of base rows is needed. The view is `base + overlay`, so when a delta arrives the pending ops are re-applied on top of the new base automatically. This is the simple version of Linear's rebase, and it is the approach I would start with (**design choice, not from Linear's sources**).
- **Rollback:** on `rejected`, drop the overlay ops for that tx, keep the row as the server has it, and show a toast with an undo or retry action.
- **Idempotency:** `applied_tx` returns the stored result on retry, so a flush after a dropped response is safe.
- **Undo:** build `inverse` from `prev` and submit it as a new transaction. This matches the "reversible transactions" idea in Linear's write-up, but the exact mechanism is **UNVERIFIED** for Linear.

### 3.6 Startup order

1. Open IndexedDB, read `meta` and all rows per table (small data, one read per table).
2. Build the store and render. No network involved.
3. `pull(since = meta.lastSyncId)`. Use `snapshot()` if `resync_required` or schema hash changed.
4. `flush()` the outbox.
5. Subscribe to Broadcast nudges on `household:<id>`. On reconnect, run step 3 again.

Target: first render from IndexedDB well under one frame of work at Cellier's volumes. **UNVERIFIED**, measure it.

### 3.7 Edge cases to test

- Two devices write the same row: last-writer-wins per field via `updated_at` on the server, or reject when `prev` no longer matches (optimistic concurrency). Choose per table; `prev` makes conflict detection possible.
- Delete while an edit is pending: the server rejects the update (row gone); the client shows a restore toast.
- Offline for days: `since` older than retention, so `resync_required`.
- Schema migration: bump the `__schemaHash`; clear the base cache but keep the outbox after migrating it.

---

## 4. State library comparison (React 19, 2026)

Bundle sizes are minified+gzipped where stated. Most figures are third-party and should be checked on bundlephobia or in a build analysis.

| Library | Size (as found) | Source status | Fit for this pattern | Notes |
|---|---|---|---|---|
| Zustand | "~3 KB" per PkgPulse table, 2026-03-09 | Secondary. bundlephobia returned 429 during research; **UNVERIFIED** | Good. Selectors via `useSyncExternalStore`; plain Map-based store works | Lowest friction. You write the sync layer yourself |
| Valtio | "~3 KB" per PkgPulse | Secondary, **UNVERIFIED** | Good for proxies over the model graph | Proxy identity pitfalls with large maps |
| Legend-State | Site claims "~4 KB minified and gzipped" core; PkgPulse table says "~14 KB" | Conflicting. **UNVERIFIED** | Strong: built-in observables, persistence, and a Supabase sync plugin (`@legendapp/state/sync-plugins/supabase`) | Plugin sits on supabase-js (~51.7 kB gz per a comparison site, **UNVERIFIED**) |
| MobX | Not measured here. **UNVERIFIED**, commonly cited around 15 to 16 KB gz | Unverified | Matches Linear's own choice (per the write-up) | Heavier, class/decorator-oriented |
| Jotai | Not measured. **UNVERIFIED**, commonly cited around 3 KB | Unverified | Atoms work for per-entity subscriptions; many atoms for thousands of rows is awkward | No built-in sync |
| TanStack DB | Bundlephobia shows 103.5 kB gz for v0.15.2 **including dependencies**; core size **UNVERIFIED** | Pre-1.0. Official page labels it beta. A search result mentions a 1.0 RC (late October 2026, secondary, **UNVERIFIED**) | Closest off-the-shelf match: collections, live queries, optimistic mutations with `@tanstack/electric-db-collection` | Stability and size are the risks. Watch for 1.0 |
| useSyncExternalStore (plain React) | 0 KB | React built-in | Enough for this app; you write a ~150-line store | No selector helper; add `useSelector(store, fn, eq)` |

Sources: [PkgPulse guide, 2026-03-09](https://www.pkgpulse.com/guides/zustand-vs-legend-state-vs-valtio-2026); [Legend-State Supabase docs](https://www.legendapp.com/open-source/state/v3/sync/supabase/); [bundlephobia @tanstack/db](https://bundlephobia.com/package/@tanstack/db); [TanStack DB 1.0 RC blog](https://tanstack.com/blog/tanstack-db-1.0-rc1-going-all-in-on-oracles); [TanStack and Electric partnership](https://tanstack.com/blog/electric-partnership).

### Recommendation for Cellier

- **Store:** Zustand, or a small hand-written store with `useSyncExternalStore`. Use normalised `Map`s per table and memoised selectors. Keep derived indexes (for example items by location) in the store, updated on delta and optimistic apply.
- Avoid MobX and Valtio unless the model graph needs deep reactive objects. Cellier's data is flat rows.
- Revisit TanStack DB when 1.0 is confirmed on npm and the changelog. It already implements the overlay and live-query model, and Electric is Supabase-native.

---

## 5. Off-the-shelf sync layers (cost and fit on a free budget)

| Option | Licence and self-host | Supabase fit | Cost signal (as found) | Verdict for Cellier |
|---|---|---|---|---|
| PowerSync | Hosted and self-hostable service; Postgres to SQLite via logical replication | Good, Supabase partner | Free "Starter" plan with soft limits per pricing page; third-party cites 2 GB/month synced and Pro about $49/month. **UNVERIFIED** numbers | Solid, but adds a managed service, sync rules, and a second database |
| ElectricSQL (Electric) | Apache 2.0, self-host free | Native with Supabase Auth and Postgres | Self-host free. Electric Cloud pricing unclear (**UNVERIFIED**) | Read-sync via Shapes; you still write your own write path. Needs a running Electric service |
| Rocicorp Zero | Apache 2.0 client and server, self-host free | Postgres supported; alpha or beta status per secondary sources | Managed "Hobby" about $30/month per aggregator (**UNVERIFIED**) | Powerful, but heavier and younger |
| Replicache | Free and open source since 2024 per Rocicorp forum; maintenance mode | Works with any backend via push/pull endpoints | No cost | Shape matches our pull/push design exactly, but no new features. Risky to start on |
| RxDB | Open source core, premium plugins paid (**UNVERIFIED** licence details) | Has replication plugins; needs your backend | Free core | Mature. Adds a database abstraction to learn |
| InstantDB | Hosted sync and storage | Not Supabase | Free tier (**UNVERIFIED**) | Vendor lock-in; skip |
| Triplit | Open source, hosted beta (**UNVERIFIED**) | A draft RxDB article says Supabase acqui-hired Triplit in October 2025 (**UNVERIFIED**) | Unknown | Status unclear; skip |

Supabase's own free tier was reported as 500 MB database, 50,000 MAUs and two projects, with pause after one week of inactivity (third-party, **UNVERIFIED** against supabase.com/pricing). Electric and Zero self-host need an always-on service, which the free budget may not cover.

### Is hand-rolling justified?

Yes, for Cellier's scope:

- Data is small (thousands of rows per household). A full-table snapshot is cheap, so bootstrap is simple.
- The hard parts are an outbox with idempotency, a sync-ID delta pull with tombstones, and rebase or overlay. That is roughly 300 to 500 lines of TypeScript plus SQL, and it can be tested with a fake server.
- No extra always-on service, no second database, and it runs on Supabase's free tier.
- Risks: correctness bugs in edge cases (section 3.7). Mitigate with property tests on the outbox and a small chaos test that drops responses.

Switch to a library if: multiple tenants with large data, true multi-writer merges need CRDTs, or TanStack DB 1.0 is confirmed and fits.

---

## 6. Open questions and UNVERIFIED items

- Linear's talk details (rebase, rollback, partial bootstrap, undo) were not read from a primary transcript. **UNVERIFIED.**
- Whether Linear keeps tombstones in a separate table. **UNVERIFIED.**
- Current Supabase Realtime message and payload limits and RLS cost for Broadcast private channels. **UNVERIFIED.**
- Bundle sizes for Zustand, Valtio, Jotai and MobX. **UNVERIFIED** (bundlephobia rate-limited).
- TanStack DB 1.0 status and core bundle size. **UNVERIFIED.**
- PowerSync, Zero and Electric pricing and limits. **UNVERIFIED** (third-party aggregators).
- Triplit acquisition and status. **UNVERIFIED.**

---

## 7. Source URLs

Primary or near-primary:

- Linear, "Scaling the Linear Sync Engine" (2023-06-29): https://linear.app/blog/scaling-the-linear-sync-engine
- Linear, "Rebuilding the delta sync read path" (dated 2026-08-18 on the page): https://linear.app/blog/rebuilding-delta-sync-read-path
- Linear, offline mode docs: https://linear.app/docs/offline-mode
- wzhudev, reverse-linear-sync-engine: https://github.com/wzhudev/reverse-linear-sync-engine (SUMMARY.md: https://github.com/wzhudev/reverse-linear-sync-engine/blob/main/SUMMARY.md)
- wzhudev, DEV write-up: https://dev.to/wzhudev/i-reversed-linears-sync-engine-to-see-how-it-works-3cj
- Supabase, Realtime: subscribing to database changes: https://supabase.com/docs/guides/realtime/subscribing-to-database-changes
- Supabase partner pages: https://supabase.com/partners/powersync , https://supabase.com/partners/electricsql
- TanStack DB: https://github.com/TanStack/db , https://tanstack.com/db/latest
- TanStack and Electric partnership: https://tanstack.com/blog/electric-partnership
- Legend-State Supabase sync: https://www.legendapp.com/open-source/state/v3/sync/supabase/
- Rocicorp Zero: https://zero.rocicorp.dev/ , licence: https://zero.rocicorp.dev/docs/open-source
- PowerSync pricing: https://powersync.com/pricing
- Electric pricing (third-party only): https://toolradar.com/tools/electric-sql/pricing

Secondary (treat as hints):

- Local-first FM episode 15 transcript: https://localfirst-fm.vercel.app/15/transcript
- PkgPulse state library guide (2026-03-09): https://www.pkgpulse.com/guides/zustand-vs-legend-state-vs-valtio-2026
- Bundlephobia TanStack DB: https://bundlephobia.com/package/@tanstack/db
- Electric Supabase compatibility summary: https://toolradar.com/compare/electric-sql-vs-supabase
- Replicache licence change and open-source note (forum): https://forums.basehub.com/rocicorp/mono/1
