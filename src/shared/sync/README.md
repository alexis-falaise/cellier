# Sync engine

Local-first store and sync for Cellier (spec: `docs/architecture/02-*`, contract: `contract.ts`).
Screens read an in-memory view (server base + pending overlay) and never wait on the network.

## Session lifecycle (app shell)

```ts
import { startSync, stopSync, switchHousehold, signOutSync } from '@/shared/sync';

await startSync({ userId, householdId }); // after sign-in; boots from IndexedDB first, then syncs
await switchHousehold(otherHouseholdId); // keeps the outbox of the previous household
stopSync(); // stop the engine and keep local data
await signOutSync(); // stop the engine and wipe IndexedDB (the device id is kept)
```

`startSync` is idempotent and loads the Supabase transport lazily. Tests pass `transport`,
`environment` and `dbName`.

## Reading data in a screen

Use the hooks from `src/entities/*`. They return referentially stable values: a component
re-renders only when what it reads changed.

```tsx
const products = useProductViews(); // live products with totals, sorted in French
const product = useProductView(id); // follows id aliases after merges
const stock = usePantryStock(pantryId);
const groceries = useOpenGroceryEntries();
const sync = useSyncSummary(); // status, pendingCount, attention, offline…
```

For ad-hoc reads, `useStore(selector, isEqual?)` takes any `(snapshot) => T`. Memoise derived
arrays with `createSelector` from `src/entities/lib/selector.ts`, or `useStore` will loop.

## Mutating

```ts
const mutate = useMutate();
const productId = await mutate('product.create', { productId: crypto.randomUUID(), name: 'Riz' });
await mutate('stock.add', { pantryId, productId, quantity: 1, source: 'form' });
```

`mutate` validates the call (it throws `MutationValidationError`), applies it optimistically,
persists it in the outbox and schedules a flush. It resolves with the row id. On a natural-key
match, that is the id of the existing row: a tombstoned match is restored.

`syncActions` exposes `syncNow`, `undo(mutationId)`, `discardAttention`, `retryAttention`,
`markActivityRead`, `quarantineCsv`, `discardQuarantined` and `resolveId`.

## Layout

| File                                    | Role                                                                |
| --------------------------------------- | ------------------------------------------------------------------- |
| `hlc.ts`                                | Hybrid logical clock                                                |
| `reducers/`                             | Pure reducer per mutation: validate, apply, touches                 |
| `store.ts`                              | Base + overlay view; snapshots that keep their identity             |
| `outbox.ts`                             | Batching, response handling (§7), aliases, attention and quarantine |
| `engine.ts`                             | Triggers, locks, backoff, pull paging, realtime nudges, undo        |
| `transport.ts` / `supabaseTransport.ts` | Transport interface / Supabase RPC + realtime                       |
| `session.ts` / `react.ts`               | App-wide singleton and React bindings                               |
| `../db/`                                | IndexedDB (idb): rows, outbox, cursor, aliases, activity            |

## Testing

`testing/` has a `FakeServer` (an independent model of the SQL rules of `apply_mutations` and
`pull_changes`) and a `FakeTransport` (fault injection, nudges, call log). Tests use
`fake-indexeddb/auto` and `createManualEnvironment()`. They never import the Supabase client.

```ts
const server = new FakeServer();
const transport = new FakeTransport(server, ALICE);
const engine = createSyncEngine({ db: await openCellierDb(uniqueName), transport, userId: ALICE,
  householdId: HOUSEHOLD, environment: createManualEnvironment() });
await engine.start(); await engine.mutate('stock.add', {...}); await engine.settle();
```

`reducers.test.ts` holds a randomised property test: after every step, the optimistic view must
equal the server state.
