import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import type { GroceryId, Gtin, HouseholdId, PantryId, ProductId, PullResponse, UserId } from '@/domain/types';
import { stockKey } from '@/domain/types';
import { type CellierDatabase, openCellierDb } from '@/shared/db/cellierDb';
import { type CellierSyncEngine, createSyncEngine } from './engine';
import { createManualEnvironment } from './environment';
import { FakeServer } from './testing/fakeServer';
import { FakeTransport } from './testing/fakeTransport';
import { ALICE, BOB, HOUSEHOLD, idGen, PANTRY } from './testing/fixtures';

let dbCounter = 0;
const running: CellierSyncEngine[] = [];
afterEach(() => {
  for (const e of running.splice(0)) e.stop();
});

interface Clock {
  t: number;
}

function world() {
  const clock: Clock = { t: Date.UTC(2026, 10, 10, 12) };
  const server = new FakeServer({ now: () => clock.t });
  server.createHousehold(HOUSEHOLD, ALICE, 'Maison', PANTRY);
  server.addMember(HOUSEHOLD, BOB);
  return { clock, server };
}

async function device(
  w: ReturnType<typeof world>,
  userId: UserId,
  prefix: string,
  options: { db?: CellierDatabase; transport?: FakeTransport; boot?: boolean } = {},
) {
  const db = options.db ?? (await openCellierDb(`engine-test-${++dbCounter}`));
  const transport = options.transport ?? new FakeTransport(w.server, userId);
  const env = createManualEnvironment();
  const engine = createSyncEngine({
    db,
    transport,
    userId,
    householdId: HOUSEHOLD,
    environment: env,
    debounceMs: 1e9,
    random: () => 0.5,
    uuid: idGen(prefix),
    now: () => w.clock.t,
  });
  running.push(engine);
  await engine.start();
  if (options.boot !== false) await engine.settle();
  const tick = (ms = 1000) => {
    w.clock.t += ms;
  };
  const sync = async () => {
    await engine.settle();
    await engine.sync('manual');
    await engine.settle();
  };
  const view = () => engine.store.getSnapshot();
  const qty = (productId: string, pantryId: string = PANTRY) =>
    view().rows.stock.get(stockKey(pantryId as PantryId, productId as ProductId))?.quantity ?? 0;
  return { db, transport, env, engine, tick, sync, view, qty };
}

const productId = (n: number) => `99999999-0000-4000-8000-${String(n).padStart(12, '0')}` as ProductId;

describe('engine with a fake server', () => {
  it('boots from IndexedDB before any network and keeps pending mutations', async () => {
    const w = world();
    const a = await device(w, ALICE, 'a');
    const p = productId(1);
    a.engine.mutate('product.create', { productId: p, name: 'Pâtes' });
    a.engine.mutate('stock.add', { pantryId: PANTRY, productId: p, quantity: 2 });
    await a.engine.outbox.idle();
    a.engine.stop();

    // A transport whose pull never answers: start() must still resolve with the cached view.
    const hanging = new FakeTransport(w.server, ALICE);
    hanging.pullChanges = () => new Promise<PullResponse>(() => {});
    hanging.applyMutations = () => new Promise(() => {});
    const b = await device(w, ALICE, 'b', { db: a.db, transport: hanging, boot: false });
    expect(b.view().rows.product.get(p)?.name).toBe('Pâtes');
    expect(b.qty(p)).toBe(2);
    expect(b.view().overlay).toHaveLength(2);
    expect(b.view().rows.pantry.get(PANTRY)?.name).toBe('Cellier');
  });

  it('flushes through apply_mutations then pulls; the outbox empties and the base holds the rows', async () => {
    const w = world();
    const a = await device(w, ALICE, 'a');
    const p = productId(1);
    a.engine.mutate('product.create', { productId: p, name: 'Riz' });
    const mv = a.engine.mutate('stock.add', { pantryId: PANTRY, productId: p, quantity: 3, source: 'scan' });
    expect(a.qty(p)).toBe(3);
    await a.sync();
    expect(a.transport.applyCalls).toHaveLength(1);
    expect(a.transport.applyCalls[0]?.mutations.map((m) => m.name)).toEqual(['product.create', 'stock.add']);
    expect(a.view().overlay).toHaveLength(0);
    expect(a.engine.outbox.all()).toHaveLength(0);
    expect(a.qty(p)).toBe(3);
    expect(a.view().rows.movement.get(mv)?.seq).toBeLessThan(Infinity);
    expect(a.view().rows.movement.get(mv)?.source).toBe('scan');
    expect(a.view().status.kind).toBe('idle');
  });

  it('keeps an acked mutation in the overlay until the cursor reaches ackedAtSyncId', async () => {
    const w = world();
    const a = await device(w, ALICE, 'a');
    const p = productId(1);
    a.engine.mutate('product.create', { productId: p, name: 'Lait' });
    a.engine.mutate('stock.add', { pantryId: PANTRY, productId: p, quantity: 4 });
    a.transport.pullFaults.push({ kind: 'transport', before: true });
    await a.sync();
    const entries = a.engine.outbox.all();
    expect(entries.every((e) => e.state === 'acked')).toBe(true);
    expect(a.view().overlay).toHaveLength(2);
    expect(a.qty(p)).toBe(4); // no flicker back to the stale base
    await a.sync();
    expect(a.view().overlay).toHaveLength(0);
    expect(a.qty(p)).toBe(4);
  });

  it('retries after a lost response without a double effect (idempotent replay)', async () => {
    const w = world();
    const a = await device(w, ALICE, 'a');
    const p = productId(1);
    a.engine.mutate('product.create', { productId: p, name: 'Café' });
    a.engine.mutate('stock.add', { pantryId: PANTRY, productId: p, quantity: 5 });
    a.transport.applyFaults.push({ kind: 'transport', before: false });
    await a.sync();
    expect(a.view().status.kind).toBe('error');
    expect(a.engine.outbox.all().every((e) => e.state === 'pending' && e.attempts === 1)).toBe(true);
    await a.sync();
    const last = a.transport.applyCalls.at(-1);
    expect(last?.mutations.map((m) => m.id)).toEqual(a.transport.applyCalls[0]?.mutations.map((m) => m.id));
    expect(w.server.rows(HOUSEHOLD, 'stock').find((s) => s.productId === p)?.quantity).toBe(5);
    expect(w.server.rows(HOUSEHOLD, 'movement')).toHaveLength(1);
    expect(a.qty(p)).toBe(5);
  });

  it('a batch with an invalid middle mutation: others applied, that one goes to À vérifier', async () => {
    const w = world();
    const a = await device(w, ALICE, 'a');
    const b = await device(w, BOB, 'b');
    const p = productId(1);
    a.engine.mutate('product.create', { productId: p, name: 'Pain' });
    await a.sync();
    b.engine.mutate('product.create', { productId: productId(2), name: 'Beurre' });
    await b.sync();
    // A has not pulled Bob's product: the rename passes client validation but not the server's.
    a.engine.mutate('stock.add', { pantryId: PANTRY, productId: p, quantity: 1 });
    a.engine.mutate('product.update', { productId: p, fields: { name: 'beurre' } });
    a.engine.mutate('stock.add', { pantryId: PANTRY, productId: p, quantity: 2 });
    expect(a.view().rows.product.get(p)?.name).toBe('beurre');
    await a.sync();
    expect(a.view().attention).toHaveLength(1);
    expect(a.view().attention[0]?.attentionReason).toBe('name_taken');
    expect(a.view().rows.product.get(p)?.name).toBe('Pain');
    expect(a.qty(p)).toBe(3);
    await a.engine.discardAttention(a.view().attention[0]?.id as never);
    expect(a.view().attention).toHaveLength(0);
  });

  it('merge remap: same GTIN created on two offline devices converges on one product (cases 5, 6)', async () => {
    const w = world();
    const a = await device(w, ALICE, 'a');
    const b = await device(w, BOB, 'b');
    const cave = '77777777-0000-4000-8000-000000000001' as PantryId;
    a.engine.mutate('pantry.create', { pantryId: cave, name: 'Cave' });
    await a.sync();
    await b.sync();
    const gtin = '03017620422003' as Gtin;
    const pa = productId(10);
    const pb = productId(20);
    a.engine.mutate('product.create', { productId: pa, name: 'Nutella', gtin });
    a.engine.mutate('stock.add', { pantryId: PANTRY, productId: pa, quantity: 1 });
    b.engine.mutate('product.create', { productId: pb, name: 'Nutella 400 g', gtin, brand: 'Ferrero' });
    b.engine.mutate('stock.add', { pantryId: cave, productId: pb, quantity: 2 });
    await b.sync();
    // A's second mutation comes back as `retry`, so it is still pending when the merge result arrives.
    let first = true;
    a.transport.transformApply = (r) => {
      if (!first) return r;
      first = false;
      const [created, added] = r.results;
      return { ...r, results: [created, { id: added?.id, status: 'retry', code: 'transient' }] as typeof r.results };
    };
    await a.sync();
    expect(a.view().status).toMatchObject({ kind: 'error', reason: 'server' });
    expect(a.engine.resolveId(pa)).toBe(pb);
    const pendingAdd = a.engine.outbox.all().find((e) => e.envelope.name === 'stock.add');
    if (!pendingAdd) throw new Error('missing stock.add');
    expect((pendingAdd.envelope.args as { productId: string }).productId).toBe(pb);
    await a.sync();
    await b.sync();
    for (const d of [a, b]) {
      const live = [...d.view().rows.product.values()].filter((x) => !x.deletedAt);
      expect(live.map((x) => x.id)).toEqual([pb]);
      expect(d.qty(pb, PANTRY) + d.qty(pb, cave)).toBe(3);
    }
    // A later mutation that still names the alias lands on the canonical row.
    a.engine.mutate('stock.add', { pantryId: PANTRY, productId: pa, quantity: 1 });
    expect(a.qty(pb)).toBe(2);
  });

  it('dependants of a failed create are grouped under it (dependency_failed, case 19)', async () => {
    const w = world();
    const a = await device(w, ALICE, 'a');
    const b = await device(w, BOB, 'b');
    const p = productId(1);
    a.engine.mutate('product.create', { productId: p, name: 'Thé' });
    await a.sync();
    await b.sync();
    b.engine.mutate('product.delete', { productId: p });
    await b.sync();
    const g = '66666666-0000-4000-8000-000000000001' as GroceryId;
    a.engine.mutate('grocery.add', { groceryId: g, productId: p });
    a.engine.mutate('grocery.update', { groceryId: g, fields: { quantity: 3 } });
    await a.sync();
    // Same batch as its parent: the server answers `gone` for it, the client groups it under the parent.
    const sent = a.transport.applyCalls.flatMap((c) => c.mutations.map((m) => m.name));
    expect(sent.filter((n) => n === 'grocery.update')).toHaveLength(1);
    const reasons = a.view().attention.map((e) => [e.envelope.name, e.attentionReason]);
    expect(reasons).toEqual([
      ['grocery.add', 'gone'],
      ['grocery.update', 'dependency_failed'],
    ]);
    // «Restaurer et appliquer»: restore the product, then re-send both under fresh ids.
    await a.engine.retryAttention(a.view().attention[0]?.id as never);
    await a.sync();
    expect(a.view().attention).toHaveLength(0);
    const entries = [...a.view().rows.grocery.values()];
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ productId: p, quantity: 3 });
    expect(a.view().rows.product.get(p)?.deletedAt).toBeNull();
  });

  it('quarantines every queued mutation of a removed member (case 15)', async () => {
    const w = world();
    const b = await device(w, BOB, 'b');
    const p = productId(1);
    b.engine.mutate('product.create', { productId: p, name: 'Sel' });
    b.engine.mutate('stock.add', { pantryId: PANTRY, productId: p, quantity: 1 });
    w.server.removeMember(HOUSEHOLD, BOB);
    await b.sync();
    expect(b.view().notice).toBe('not_member');
    expect(b.view().attention.map((e) => e.state)).toEqual(['quarantined', 'quarantined']);
    expect(b.view().overlay).toHaveLength(0);
    expect(b.engine.quarantineCsv().split('\n')).toHaveLength(3);
    await b.engine.discardQuarantined();
    expect(b.engine.outbox.all()).toHaveLength(0);
    expect(b.view().notice).toBeNull();
  });

  it('resyncs with a snapshot after resync_required', async () => {
    const w = world();
    const a = await device(w, ALICE, 'a');
    const b = await device(w, BOB, 'b');
    const before = a.view().cursor;
    b.engine.mutate('product.create', { productId: productId(1), name: 'Farine' });
    await b.sync();
    w.server.pruneLog(HOUSEHOLD, w.server.state(HOUSEHOLD).head);
    await a.sync();
    expect(a.transport.pullCalls.slice(-2).map((c) => c.since)).toEqual([before, 0]);
    expect(a.view().rows.product.get(productId(1))?.name).toBe('Farine');
    expect(a.view().cursor).toBe(w.server.state(HOUSEHOLD).head);
  });

  it('pages through deltas and applies deletes', async () => {
    const w = world();
    const a = await device(w, ALICE, 'a');
    const b = await device(w, BOB, 'b');
    for (let i = 1; i <= 5; i += 1) b.engine.mutate('product.create', { productId: productId(i), name: `P${i}` });
    await b.sync();
    w.server.removeMember(HOUSEHOLD, BOB);
    const transport = a.transport;
    const pull = transport.pullChanges.bind(transport);
    transport.pullChanges = (req) => pull({ ...req, limit: 2 });
    await a.sync();
    expect(transport.pullCalls.length).toBeGreaterThan(3);
    expect([...a.view().rows.product.keys()]).toHaveLength(5);
    expect(a.view().rows.member.has(BOB)).toBe(false);
  });

  it('two members take the last unit: the second is clamped and gets an activity entry (case 2)', async () => {
    const w = world();
    const a = await device(w, ALICE, 'a');
    const p = productId(1);
    a.engine.mutate('product.create', { productId: p, name: 'Yaourt' });
    a.engine.mutate('stock.add', { pantryId: PANTRY, productId: p, quantity: 1 });
    await a.sync();
    const b = await device(w, BOB, 'b');
    a.engine.mutate('stock.remove', { pantryId: PANTRY, productId: p, quantity: 1, reason: 'consume' });
    b.engine.mutate('stock.remove', { pantryId: PANTRY, productId: p, quantity: 1, reason: 'consume' });
    await a.sync();
    await b.sync();
    expect(b.qty(p)).toBe(0);
    const activity = b.view().activity;
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({ kind: 'clamped', params: { requested: 1, applied: 0, product: 'Yaourt' } });
    expect(a.view().activity).toHaveLength(0);
  });

  it('recount versus a concurrent withdrawal records the adjusted count (case 4)', async () => {
    const w = world();
    const a = await device(w, ALICE, 'a');
    const p = productId(1);
    a.engine.mutate('product.create', { productId: p, name: 'Pommes' });
    a.engine.mutate('stock.add', { pantryId: PANTRY, productId: p, quantity: 6 });
    await a.sync();
    const b = await device(w, BOB, 'b');
    b.engine.mutate('stock.remove', { pantryId: PANTRY, productId: p, quantity: 1, reason: 'consume' });
    await b.sync();
    a.engine.mutate('stock.recount', { pantryId: PANTRY, productId: p, counted: 5 });
    await a.sync();
    expect(a.qty(p)).toBe(5);
    expect(a.view().activity[0]).toMatchObject({ kind: 'recount_adjusted', params: { counted: 5, found: 5 } });
  });

  it('rename versus rename: the later HLC wins, the loser gets its lost value (case 8)', async () => {
    const w = world();
    const a = await device(w, ALICE, 'a');
    const p = productId(1);
    a.engine.mutate('product.create', { productId: p, name: 'Pates' });
    await a.sync();
    const b = await device(w, BOB, 'b');
    a.tick();
    a.engine.mutate('product.update', { productId: p, fields: { name: 'Pâtes Alice' } });
    b.tick(5000);
    b.engine.mutate('product.update', { productId: p, fields: { name: 'Pâtes Bob' } });
    await b.sync();
    await a.sync();
    expect(a.view().rows.product.get(p)?.name).toBe('Pâtes Bob');
    expect(a.view().activity[0]).toMatchObject({ kind: 'rejected_fields', lostValues: { name: 'Pâtes Alice' } });
  });

  it('a stock movement against a product deleted meanwhile goes to À vérifier (case 10)', async () => {
    const w = world();
    const a = await device(w, ALICE, 'a');
    const p = productId(1);
    a.engine.mutate('product.create', { productId: p, name: 'Huile' });
    await a.sync();
    const b = await device(w, BOB, 'b');
    b.engine.mutate('product.delete', { productId: p });
    await b.sync();
    a.engine.mutate('stock.add', { pantryId: PANTRY, productId: p, quantity: 1 });
    await a.sync();
    expect(a.view().attention[0]).toMatchObject({ state: 'attention', attentionReason: 'gone' });
    expect(a.qty(p)).toBe(0);
    await a.engine.retryAttention(a.view().attention[0]?.id as never);
    await a.sync();
    expect(a.qty(p)).toBe(1);
    expect(a.view().rows.product.get(p)?.deletedAt).toBeNull();
  });

  it('undo drops an unsent mutation and reverts a sent one', async () => {
    const w = world();
    const a = await device(w, ALICE, 'a');
    const p = productId(1);
    a.engine.mutate('product.create', { productId: p, name: 'Miel' });
    await a.sync();
    const add = a.engine.mutate('stock.add', { pantryId: PANTRY, productId: p, quantity: 2 });
    expect(await a.engine.undo(add)).toBeNull();
    expect(a.qty(p)).toBe(0);
    await a.engine.outbox.idle();
    expect(a.engine.outbox.all()).toHaveLength(0);
    const add2 = a.engine.mutate('stock.add', { pantryId: PANTRY, productId: p, quantity: 2 });
    await a.sync();
    const revert = await a.engine.undo(add2);
    expect(revert).not.toBeNull();
    expect(a.qty(p)).toBe(0);
    await a.sync();
    expect(a.qty(p)).toBe(0);
    expect(w.server.rows(HOUSEHOLD, 'movement').map((m) => m.kind)).toEqual(['restock', 'correction']);
  });

  it('refreshes the session once on an auth error, then retries', async () => {
    const w = world();
    const a = await device(w, ALICE, 'a');
    a.transport.pullFaults.push({ kind: 'auth', before: true });
    await a.sync();
    expect(a.transport.refreshCalls).toBe(1);
    // The retry is scheduled immediately (0 ms).
    await new Promise((r) => setTimeout(r, 10));
    await a.engine.settle();
    expect(a.view().status.kind).toBe('idle');

    a.transport.refreshResult = false;
    a.transport.pullFaults.push({ kind: 'auth', before: true });
    await a.sync();
    a.transport.pullFaults.push({ kind: 'auth', before: true });
    await a.sync();
    expect(a.view().status).toMatchObject({ kind: 'error', reason: 'auth' });
  });

  it('stops on a contract error until a manual retry', async () => {
    const w = world();
    const a = await device(w, ALICE, 'a');
    a.transport.pullFaults.push({ kind: 'contract', before: true });
    await a.sync();
    expect(a.view().status).toMatchObject({ kind: 'error', reason: 'contract' });
    const calls = a.transport.pullCalls.length;
    await a.engine.sync('timer');
    expect(a.transport.pullCalls.length).toBe(calls);
    await a.engine.sync('manual');
    expect(a.view().status.kind).toBe('idle');
  });

  it('reports offline when the network is down', async () => {
    const w = world();
    const a = await device(w, ALICE, 'a');
    a.env.online = false;
    a.engine.mutate('product.create', { productId: productId(1), name: 'Sucre' });
    a.transport.applyFaults.push({ kind: 'transport', before: true });
    await a.sync();
    expect(a.view().status).toEqual({ kind: 'offline', pendingCount: 1 });
  });

  it('a Realtime nudge with a newer sync id triggers a pull', async () => {
    const w = world();
    const a = await device(w, ALICE, 'a');
    const b = await device(w, BOB, 'b');
    b.engine.mutate('product.create', { productId: productId(1), name: 'Poivre' });
    await b.sync();
    a.transport.nudge(HOUSEHOLD, w.server.state(HOUSEHOLD).head);
    await a.engine.settle();
    expect(a.view().rows.product.has(productId(1))).toBe(true);
  });

  it('switches households and clears everything on sign-out', async () => {
    const w = world();
    const other = '33333333-3333-4333-8333-333333333333' as HouseholdId;
    w.server.createHousehold(other, ALICE, 'Chalet');
    const a = await device(w, ALICE, 'a');
    a.engine.mutate('product.create', { productId: productId(1), name: 'Bois' });
    await a.engine.setActiveHousehold(other);
    await a.engine.settle();
    expect(a.view().householdId).toBe(other);
    expect(a.view().rows.household.get(other)?.name).toBe('Chalet');
    expect(a.view().rows.product.size).toBe(0);
    await a.engine.setActiveHousehold(HOUSEHOLD);
    expect(a.view().rows.product.get(productId(1))?.name).toBe('Bois');
    await a.engine.clear();
    expect(a.view().householdId).toBeNull();
    expect(await a.db.readHousehold(HOUSEHOLD)).toEqual({ rows: [], outbox: [] });
    expect(await a.db.getMeta('device')).toBeDefined();
  });
});
