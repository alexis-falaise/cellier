# 02 — Sync protocol

This document specifies how Cellier keeps a household's data on every member's phone, how changes made
offline reach the server, and how conflicts are resolved. It is the contract between the database
(`supabase/migrations/`) and the client sync engine (`src/shared/sync/`, `src/shared/db/`,
`src/domain/mutations/`). Types are in `contracts/domain.ts` (entities, wire shapes) and
`contracts/sync.ts` (client module interfaces).

## 1. Model in one page

- **Local-first store.** The client holds every row of the active household in memory, in normalised
  maps (one `Map` per entity), persisted in IndexedDB. Screens read only from this store. No screen
  waits for the network.
- **Base and overlay.** The *base* is the last state confirmed by the server. The *overlay* is the list
  of the device's own mutations not yet reflected in the base. What the user sees, the *view*, is the
  base with the overlay replayed on top. When new server data arrives, the overlay is simply replayed
  on the new base, which is the "rebase" step of Linear-style sync.
- **Mutations.** Every user action is a *mutation*: a named intent with arguments (`stock.remove`,
  `product.update`…), a client UUID that is its idempotency key, a per-device sequence number and a
  hybrid logical clock (HLC) timestamp. It is applied to the view at once (optimistic update), stored in
  the IndexedDB *outbox*, and sent later by the *flusher* to one RPC, `apply_mutations`.
- **Change log and sync id.** Every server-side change of a synced row appends a row to
  `private.change_log` with the household's next *sync id*, a gap-free counter per household. A client
  remembers the last sync id it applied, its *cursor*, and asks `pull_changes(since = cursor)` for what
  changed after it.
- **Nudges.** A database trigger sends a Realtime Broadcast message `{syncId}` on the private channel
  `household:<householdId>` once per committed transaction. The message carries no data; it only tells
  connected clients to pull. Delivery is at most once, so clients also pull on start, on return to the
  foreground, on reconnect and on a slow timer.
- **Conflict rules.** Stock is a ledger of deltas, so concurrent withdrawals add up; the server clamps
  withdrawals at zero. Descriptive fields use per-field last-writer-wins decided by HLC. Deletes are
  tombstones. Creating the same thing twice offline converges on one row by natural key.

## 2. Server objects

| Object | Kind | Role |
|---|---|---|
| `private.household_sync` | table | `last_sync_id` counter per household; its row lock serialises all writes of a household. `pruned_through`: change-log rows up to this id were deleted. |
| `private.change_log` | table | `(household_id, sync_id, entity, row_id, op)`. Entities: `household`, `member`, `pantry`, `category`, `product`, `stock`, `movement`. Row content is not stored: pull reads the current row. Kept 30 days. |
| `private.applied_mutations` | table | Idempotency: one row per mutation id with its stored result. Kept 60 days. |
| `private.id_aliases` | table | Ids merged into a canonical row after an add-versus-add conflict. |
| `private.log_change()` | trigger | After insert/update/delete on every synced table: next sync id, change-log row, nudge. Skips no-op updates. |
| `private.movement_before_insert()` | trigger | Ledger: locks the household and the stock row, clamps withdrawals, turns a recount into a delta, sets `quantity_after`, `actor_id`, `created_at`. |
| `private.movement_after_insert()` | trigger | Ledger: applies `applied_delta` to `public.stock`. |
| `public.apply_mutations(p_request jsonb)` | RPC, security invoker | Write path (§4). |
| `public.pull_changes(p_household, p_since, p_limit)` | RPC, stable, security invoker | Read path (§5). |

Ordering guarantee. Every write transaction of a household first takes the row lock on
`household_sync` (directly in `apply_mutations` and the household RPCs, through the ledger trigger or
the change-log trigger otherwise) and holds it until commit. Sync ids are therefore assigned and
committed in the same order, and a reader can never see sync id *n + 1* without *n*. `pull_changes` is
`STABLE`, so all its statements read one snapshot: the cursor it returns always matches the rows it
returns.

## 3. Mutation catalogue

Wire envelope (`MutationEnvelope` in `contracts/domain.ts`):

```json
{ "id": "uuid", "seq": 41, "name": "stock.remove",
  "args": { "pantryId": "uuid", "productId": "uuid", "quantity": 1, "reason": "consume" },
  "hlc": "001762780000000.000003.5b1c1a0e-…", "clientAt": "2026-11-10T17:31:04.120Z" }
```

Common rules:

- `id` is generated when the user acts and never changes, including on retries. For stock mutations it
  is also the id of the movement row the server writes.
- Every id in `args` that names a pantry, category or product is resolved through `id_aliases` on the
  server, so a mutation queued before an alias merge still lands on the canonical row.
- Field-level last-writer-wins (LWW): each row has a hidden `field_clock` (field name → HLC of the last
  accepted write). An update field is applied only if its mutation's HLC is greater than the stored clock
  for that field. Losing fields are returned in `rejectedFields`. The server clamps an HLC whose wall
  clock is more than 5 minutes ahead of server time.
- "Optimistic effect" below is what the client reducer in `src/domain/mutations/` does to the view;
  "server effect" is what `apply_mutations` does. Reducers must predict the server exactly when no
  concurrent change exists.

| Name | Arguments | Optimistic effect | Server effect | Conflict rule | Result data |
|---|---|---|---|---|---|
| `household.rename` | `name` (1–80) | Household name changes. | Owner only, else `invalid/not_owner`. LWW on `name`. | LWW. | `rejectedFields` |
| `member.updateSelf` | `displayName?`, `notifyRunningLow?`, `notifyDigest?` | Own member row changes. | Updates the caller's own row. | Arrival order (only the member edits it). | `rejectedFields` (always empty) |
| `pantry.create` | `pantryId`, `name` (1–60), `icon?`, `color?`, `sortOrder?` | Pantry row added. | Insert; if a pantry with the same normalised name exists (tombstones included) the existing row is kept, revived if deleted, empty icon/colour filled, and the new id becomes an alias. | Natural key: normalised name. | `canonicalId`, `merged`, `restored` |
| `pantry.update` | `pantryId`, `fields: {name?, icon?, color?, sortOrder?}` | Fields change. | `gone` if missing or deleted. `invalid/name_taken` if the new name collides. LWW per field. | LWW; delete wins over update. | `rejectedFields` |
| `pantry.delete` / `pantry.restore` | `pantryId` | `deletedAt` set / cleared; stock of a deleted pantry leaves totals. | Tombstone set / cleared. Idempotent. | Arrival order. | — |
| `category.create` | `categoryId`, `name`, `icon?`, `color?`, `sortOrder?` | Category added. | As `pantry.create` (natural key: normalised name). | Natural key. | `canonicalId`, `merged`, `restored` |
| `category.update` | `categoryId`, `fields` | Fields change. | As `pantry.update`. | LWW. | `rejectedFields` |
| `category.delete` / `category.restore` | `categoryId` | Tombstone. Products keep their `categoryId`; the view shows them as "Sans catégorie". | Tombstone. | Arrival order. | — |
| `product.create` | `productId`, `name`, `gtin?`, `catalogGtin?`, plus any product field | Product added (or, if the local store already has a live product with the same GTIN, nothing is added and the client uses that product instead). | Natural key: `gtin` when present, else normalised name among products without GTIN. Existing row kept, revived if deleted, only empty fields filled; new id becomes an alias. Unknown `catalogGtin` is dropped. | Natural key; merge never overwrites a set value. | `canonicalId`, `merged`, `restored` |
| `product.update` | `productId`, `fields` (see `ProductFields`) | Fields change. | `gone` if deleted. `invalid/name_taken` for a custom product renamed onto another. LWW per field. | LWW; delete wins. | `rejectedFields` |
| `product.delete` / `product.restore` | `productId` | Tombstone; the product leaves lists, its stock is kept. | Tombstone; stock rows stay (restore brings everything back). | Arrival order. | — |
| `stock.add` | `pantryId`, `productId`, `quantity` 1–9999 | Pantry quantity + q; pending movement `restock`. | `gone` if pantry or product deleted. Ledger row `restock`. | Deltas commute. | `movementId`, `requested`, `applied`, `quantityAfter` |
| `stock.remove` | `pantryId`, `productId`, `quantity` 1–9999, `reason: consume\|discard` | Quantity − q, floored at 0; pending movement. | Ledger row with `applied = max(−q, −current)` under lock. `clamped` when less than requested. | Deltas commute; floor at 0 on the server. | as above |
| `stock.recount` | `pantryId`, `productId`, `counted` 0–99999 | Quantity = counted. | Delta computed at apply time: `counted − current`. Never clamped. | "Count at the moment it reaches the server". | as above |
| `stock.transfer` | `fromPantryId`, `toPantryId`, `productId`, `quantity` | Source − q (floored), destination + same amount. | Out-leg clamped like a withdrawal; in-leg receives exactly what left the source; same `transfer_id`. `clamped` if short. | Deltas; total conserved. | plus `inMovementId`, `toQuantityAfter` |
| `stock.revert` | `movementId` | The movement's effect is inverted (undo). | `correction` movement(s) inverting `applied_delta`; a transfer is undone as a whole. `invalid/already_reverted`, `invalid/not_revertible` (recount, correction, nothing applied). A revert that removes stock can be clamped. | One revert per movement. | plus `movementIds` |
| `grocery.add` | `groceryId`, exactly one of `productId` / `label`, `quantity?` 1–999 | Entry added to Courses. | `gone` if the product is deleted. Natural key: the open entry (unchecked, not dismissed, not deleted) of the same product; the new id becomes an alias and an empty quantity is filled. | Natural key. | `canonicalId`, `merged` |
| `grocery.update` | `groceryId`, `fields` (`label` for free text only, `quantity`, `checked`, `dismissed`) | Fields change. Checking never changes stock. | LWW per field; `checked`/`dismissed` set `checked_at`+`checked_by` / `dismissed_at` (cleared when false). Unchecking while another open entry exists for the product → `invalid/validation`. | LWW; delete wins. | `rejectedFields` |
| `grocery.delete` / `grocery.restore` | `groceryId` | Tombstone. | Tombstone. | Arrival order. | — |

Stock mutations also take an optional `source` (`scan`, `swipe`, `stepper`, `put_away`, `form`), stored on the
ledger row for Activity grouping; `stock.revert` writes `undo`. Every update whose field replaces a value
written by another device within 7 days produces a `FieldOverwrite` row (entity `overwrite` in pulls), which the
device that wrote the old value shows as «Modification remplacée».

## 4. `apply_mutations`

Call: `supabase.rpc('apply_mutations', { p_request })` with `p_request: ApplyMutationsRequest`
(`householdId`, `deviceId`, `mutations`: 1–50 envelopes in `seq` order, body under 256 KB).

Processing, in one transaction:

1. Not signed in → SQLSTATE 28000 (HTTP 401). Malformed request → 22023, oversized → 54000 (HTTP 400).
   These are *contract errors*: the client must not retry them blindly (§8).
2. Caller not a member → response `status: 'not_member'`, every result `forbidden`, nothing written.
3. Take the household lock.
4. For each mutation in order: validate the envelope (`invalid/validation` if malformed); if its id is in
   `applied_mutations`, return the stored result with `replayed: true`; otherwise claim the id, run the
   handler in a subtransaction, store the result.
   - Business outcomes are returned as statuses, never raised: `applied`, `clamped`, `gone`, `invalid`.
   - Any SQL error inside the handler rolls back that mutation only and is mapped: serialization failure,
     deadlock, lock timeout → `retry/transient` (not stored); RLS violation → `forbidden` (not stored);
     unique violation on the GTIN → `invalid/gtin_taken`; anything else → `invalid/validation` with the
     SQLSTATE in `message`, stored so a replay gets the same answer.
   - Processing stops after the first `retry` or `forbidden`; later mutations are not in `results`.
5. Respond:

```json
{ "status": "ok", "serverTime": "2026-11-10T17:31:05.002+00:00", "lastSyncId": 1834,
  "results": [ { "id": "…", "status": "clamped",
                 "data": { "movementId": "…", "requested": -2, "applied": -1, "quantityAfter": 0 } } ] }
```

Exactly-once effect: delivery is at least once (the client resends a batch whose response it did not
receive); the effect is applied once because the claim and the effect commit together, and a concurrent
duplicate waits on the claim row's unique index until the first transaction ends.

## 5. `pull_changes`

Call: `supabase.rpc('pull_changes', { p_household, p_since, p_limit })` → `PullResponse`.

| `since` | Server behaviour | Response |
|---|---|---|
| `0` | Snapshot: every row of the household, tombstones included; movements of the last 120 days. | `mode: 'snapshot'`, `toSyncId = headSyncId`, `hasMore: false` |
| `0 < since ≤ head`, `since ≥ pruned_through` | Delta: the next `limit` (default 500, max 1,000) change-log entries, compacted per row; for each, the current row, or a delete entry if it no longer exists (members who left, cascaded rows). | `mode: 'delta'`, `toSyncId` = last entry of the page, `hasMore = toSyncId < headSyncId` |
| `since < pruned_through` or `since > head` | — | `status: 'resync_required'`; the client calls again with `since = 0` |
| caller not a member | — | `status: 'not_member'` |

Rows are the camelCase shapes of `contracts/domain.ts`. Upserts are complete rows, so applying a page is
"put every row, delete every listed key, then store `toSyncId`", in one IndexedDB transaction. A page can
contain a row whose newer version is also in a later page; applying pages in order is always correct.

## 6. Client modules

Interfaces are in `contracts/sync.ts`; summary:

- `src/shared/db/` — IndexedDB database `cellier`, version 1:
  - `meta` (key: string): `device` → `{deviceId, nextSeq, hlc}`; `active-household` → id;
    `cursor:<householdId>` → `{syncId, pulledAt}`; `aliases:<householdId>` → `Record<alias, canonical>`.
  - `rows` (key `[householdId, entity, id]`, index `household` on `[householdId, entity]`).
  - `outbox` (key `id`, index `household-seq` on `[householdId, seq]`).
  - `activity` (key `id`, index `household-created`): local conflict entries (§9).
  - `catalog` (key `gtin`, index `used-at`): catalogue rows seen by this device, LRU 2,000.
- `src/shared/sync/hlc.ts` — `HybridClock` (research/15 §6.2): `next()`, `observe(remoteHlc | serverTime)`;
  state persisted in `meta.device` at most once per second.
- `src/shared/sync/store.ts` — `SyncStore`: base maps, overlay, view maps, version counter, derived
  indexes; `subscribe`/`getSnapshot` for `useSyncExternalStore`. The snapshot object is immutable and
  replaced on each commit; unchanged maps keep their identity so selectors can bail out.
- `src/domain/mutations/` — one pure reducer per mutation name: `apply(view, envelope)`,
  `touches(envelope): EntityKey[]` (the rows it changes) and `validate(args)` (client-side checks that
  mirror the server's, so most `invalid` results never happen).
- `src/shared/sync/outbox.ts` — `Outbox`: enqueue, list, state transitions, remap, quarantine.
- `src/shared/sync/engine.ts` — `SyncEngine`: boot, the single sync cycle (flush then pull), triggers,
  backoff, Realtime subscription, status.
- `src/shared/sync/react.ts` — `useStore(selector, isEqual?)`, `useMutate()`, `useSyncStatus()`.

### 6.1 View computation

- `view[key] = fold(pendingMutationsTouching(key) in seq order, base[key])`.
- When a mutation is enqueued, only the keys in `touches(m)` are recomputed. When a pull page is applied,
  only the keys in the page are recomputed (with the overlay replayed for those keys).
- Overlay membership: outbox entries in state `pending`, `inflight` or `acked` with
  `ackedAtSyncId > cursor`. An entry acknowledged by the server stays in the overlay until a pull brings
  the cursor to `ackedAtSyncId` (= `lastSyncId` of the response that acknowledged it). This prevents the
  value from flickering back between the acknowledgement and the pull that carries the server row.
- Pending stock movements appear as `Movement` rows with `seq = Infinity` and a `pending` flag in the
  derived activity list.

### 6.2 `mutate()`

`engine.mutate(name, args)` is synchronous for the caller:

1. Validate (`validate(args)`); on failure throw a typed `MutationValidationError` (the UI should have
   prevented it).
2. Build the envelope: id (`crypto.randomUUID()`, or the client id given in args for creates),
   `seq = nextSeq++`, `hlc = clock.next()`, `clientAt = new Date().toISOString()`.
3. Apply to the view and notify subscribers (same frame).
4. Start one IndexedDB transaction writing the outbox entry and `meta.device`. The flusher never sends an
   entry before its write has committed.
5. Schedule a sync cycle (debounced 250 ms, so a burst of scans goes as one batch).

### 6.3 Sync cycle

One cycle at a time per household, guarded by
`navigator.locks.request('cellier-sync:' + householdId, { ifAvailable: true })` (a second tab skips and
relies on the first). Pull and flush never overlap, so a pulled base never already contains an effect
that the overlay still applies.

1. **Flush**: while there are `pending` entries: take up to 50 in `seq` order, skipping any whose
   dependency failed; mark them `inflight`; call `apply_mutations`; handle results (§7). Stop on a
   transport error or a `retry` result and schedule a retry with backoff.
2. **Pull**: loop `pull_changes(cursor)` until `hasMore` is false; apply each page.
3. Prune: drop `acked` entries with `ackedAtSyncId ≤ cursor` from the outbox and the overlay.
4. Publish forecasts if they changed materially (04-notifications-forecasting.md).

### 6.4 Boot sequence

1. Register the service worker (non-blocking).
2. Open IndexedDB; read `meta.device` (create `deviceId` on first run) and `active-household`.
3. Read the Supabase session from local storage (`supabase.auth.getSession()`, no network). No session →
   route `/welcome`.
4. With an active household: read its `rows` and `outbox` (two indexed `getAll`), hydrate the store,
   render. Target: first meaningful paint from IndexedDB under 300 ms after launch on an iPhone 13.
5. In the background: `navigator.storage.persist()` (once), then a sync cycle (snapshot if there is no
   cursor), then join the Realtime channel (`supabase.channel('household:' + id, { config: { private: true } })`,
   after `supabase.realtime.setAuth()`), listening to events `sync` and `household_deleted`.
6. Without an active household: query `household_members` for the user's memberships (online). One →
   make it active and continue at 4 (snapshot). Several → household picker. None → `/onboarding/household`.
   Offline with no household cached → an offline empty state.

### 6.5 Triggers of a sync cycle

| Trigger | Action |
|---|---|
| `mutate()` | cycle after 250 ms (debounce) |
| App start (step 5) | cycle |
| `online` event | cycle (after a 1 s settle) |
| `visibilitychange` → visible | rejoin Realtime if not joined, cycle |
| `visibilitychange` → hidden | immediate flush attempt (best effort; iOS may suspend at any time) |
| Realtime `sync` with `syncId > cursor` | cycle (pull only if the outbox is empty) |
| Realtime channel status becomes `SUBSCRIBED` after a drop | cycle |
| Timer while visible | every 30 s if the outbox is not empty; every 5 min otherwise |
| Token refreshed (`onAuthStateChange: TOKEN_REFRESHED`) | `realtime.setAuth()`; cycle if a cycle failed with 401 |

There is no Background Sync on iOS (research/13); nothing runs while the app is suspended.

## 7. Handling results

| Status | Outbox | Overlay | User-facing |
|---|---|---|---|
| `applied` | `acked`, `ackedAtSyncId = lastSyncId` | kept until the cursor reaches it | none; if `merged`, remap (below); if `restored`, activity entry; if `rejectedFields` is not empty, activity entry with the lost values |
| `clamped` | `acked` | kept until the pull | activity entry: "Retiré 1 sur 2 — il n'en restait qu'1 quand la modification est arrivée." |
| `gone` | `attention` | removed at once | "À vérifier" list: restore the row and re-apply, or drop |
| `invalid` | `attention` | removed | "À vérifier" list with the reason (`name_taken`, `not_owner`, …); dependants marked `dependency_failed` |
| `forbidden` / response `not_member` | every entry of the household → `quarantined` | removed | "Vous ne faites plus partie de ce foyer": export the pending changes as CSV, or discard |
| `retry` | back to `pending`; cycle rescheduled with backoff | kept | none |
| missing (processing stopped earlier) | back to `pending` | kept | none |

Remap after a merge (`canonicalId !== id`): in one IndexedDB transaction, rewrite every pending
envelope whose args reference the alias, store the alias in `meta.aliases:<householdId>`, and rewrite the
in-memory overlay. The router resolves aliased ids in URLs (`/items/<alias>` shows the canonical
product).

Dependencies: an entry depends on every earlier pending `*.create` whose id appears in its args. When a
create ends in `gone`/`invalid`, its dependants move to `attention` with reason `dependency_failed`
without being sent.

## 8. Errors and retry classes

| Class | Detected by | Behaviour |
|---|---|---|
| Transport | `fetch` rejects, or no response within 15 s (AbortController) | Retry with backoff. Status `offline` if `navigator.onLine` is false, else `error/transport`. |
| Authentication | HTTP 401, PostgREST `PGRST301`/`PGRST303`, SQLSTATE 28000 | `supabase.auth.refreshSession()` once, then retry immediately. If refresh fails: status `error/auth`, banner "Reconnectez-vous", outbox kept. |
| Server transient | HTTP 5xx, 408, 429 (honour `Retry-After`), SQLSTATE 40001/40P01/55P03/57014, result `retry` | Retry with backoff. |
| Contract | HTTP 400 with SQLSTATE 22023/54000, `PGRST202` (function not found), unexpected response shape | Stop flushing; status `error/contract`; check for a service-worker update (the server is newer than the app); report to the console and the diagnostics screen. Retried after an app update or 1 h. |
| Per mutation terminal | statuses in §7 | Per row; never blocks the rest of the queue. |

Backoff: `delay = min(60 s, 1 s × 2^attempt) × (0.5 + random() / 2)`, reset after any successful call.

## 9. Conflict cases (research/15 §6.16)

"Activity" means a local activity entry (IndexedDB `activity` store, shown in the Activité screen and as
a non-blocking toast). "À vérifier" means the attention list, which batches every case that needs a
decision. A withdrawal that physically happened is always recorded.

| # | Case | Server | Client | Surfacing |
|---|---|---|---|---|
| 1 | Two offline withdrawals of the same product | Both applied; deltas add | Overlays dropped after pull | Silent |
| 2 | Two members take the last unit | First `applied`, second `clamped` to 0 | Activity entry for the second | Activity |
| 3 | Withdraw more than on hand | Applied up to stock, `clamped` | Activity with requested vs applied | Activity |
| 4 | Recount versus concurrent withdrawal | Recount measured against the quantity at apply time | Activity "compté 5, il y en avait 6 à l'arrivée" when `applied ≠ counted − predicted` | Activity |
| 5 | Same product created on two offline devices (same GTIN, or same name without GTIN) | One row; second id stored as alias; empty fields filled | Remap pending mutations; one row on screen; stock of both devices adds up | Silent |
| 6 | Same, different pantries | One product, two stock rows | Same | Silent |
| 7 | Create with the natural key of a deleted product | Tombstone revived, id kept | Row reappears | Activity |
| 8 | Rename versus rename | Higher HLC wins; loser in `rejectedFields` | Activity with the lost value and "Rétablir" (a new update) | Activity |
| 9 | Rename versus delete | Delete wins; update `gone` | À vérifier: "Restaurer et renommer" or "Abandonner" | Prompt |
| 10 | Stock movement versus product or pantry delete | `gone`, no ledger row | À vérifier: "Restaurer et appliquer" or "Abandonner" | Prompt |
| 11 | Threshold, price, category versus same field | LWW per field | Activity with the overwritten value | Activity |
| 12 | Delete versus delete | Idempotent `applied` | — | Silent |
| 13 | Move out of a pantry that was emptied meanwhile | Out-leg clamped; in-leg equals what left | Activity "Déplacé 2 sur 3" | Activity |
| 14 | Move into a deleted pantry | `gone` | À vérifier | Prompt |
| 15 | Member removed with queued mutations | `not_member` / `forbidden`; nothing written | Quarantine; local data kept until the user decides | Prompt (export CSV or discard) |
| 16 | Retry after a timeout | Stored result, `replayed: true` | Treated as the original status | Silent |
| 17 | One invalid mutation inside a batch | Others applied; that one `invalid` | That entry to À vérifier | Prompt for that item |
| 18 | Transport failure mid-batch | Unknown which committed | Same batch resent; idempotent | Silent |
| 19 | Mutation depending on a failed create | Never sent | `dependency_failed`, grouped under its parent | Prompt with the parent |
| 20 | Device clock far ahead | HLC wall clamped to server + 5 min | `|serverTime − Date.now()| > 5 min` → warning in Réglages | Settings warning |
| 21 | Device clock far behind | Loses field LWW | — | None (accepted) |
| 22 | Negative or out-of-range value | `invalid/validation` (check constraint) | Prevented by `validate()`; else À vérifier | Prompt |
| 23 | Same field, same HLC | Impossible across devices (device id ends the HLC); same device: later seq wins locally | — | — |
| 24 | Client predicts "withdraw 3" from a stale view | Server decides under lock | Optimistic value replaced on pull | Silent unless clamped |
| 25 | Custom product renamed onto an existing name | `invalid/name_taken` | À vérifier: "Un produit porte déjà ce nom" | Prompt |
| 26 | Household deleted by the owner | `household_deleted` broadcast; later calls `not_member` | Pending changes quarantined; household removed after confirmation | Prompt |

Decisions on research/15 §12 open questions: recounts mean "the count at the moment it reaches the
server"; deleting a product or pantry with stock on hand is allowed (soft delete, restorable, stock kept);
a removed member's ledger rows stay attributed to them (`actor_id` becomes null only if their account is
deleted); no "we owe" view in v1; `applied_mutations` retention is 60 days.

## 10. Tests the sync work package must ship

- Reducers: every mutation name, property-tested against a model of the server rules (clamp, LWW,
  natural keys) so the optimistic view equals the server outcome without concurrency.
- Outbox and engine with a fake server: retry after dropped responses (no double effect), batch with an
  invalid middle mutation, merge remap, dependency failure, quarantine, resync after `resync_required`,
  overlay kept until the cursor reaches `ackedAtSyncId`.
- Database (pgTAP, work package 1): the test checklist of research/15 §14, plus RLS isolation between two
  households for every table and RPC.
