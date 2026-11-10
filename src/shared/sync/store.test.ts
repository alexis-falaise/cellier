import { describe, expect, it } from 'vitest';
import type { AnyMutationEnvelope, Hlc, MutationId, ProductId, PullResponse } from '@/domain/types';
import { stockKey } from '@/domain/types';
import type { OutboxEntry } from './contract';
import { createHybridClock, formatHlc, parseHlc } from './hlc';
import { createSyncStore } from './store';
import { FakeServer } from './testing/fakeServer';
import { ALICE, DEVICE, HOUSEHOLD, PANTRY } from './testing/fixtures';

const P = 'eeeeeeee-0000-4000-8000-000000000001' as ProductId;

function entry(seq: number, envelope: Omit<AnyMutationEnvelope, 'seq' | 'hlc' | 'clientAt'>): OutboxEntry {
  const full = {
    ...envelope,
    seq,
    hlc: formatHlc(1000 + seq, 0, DEVICE),
    clientAt: '2026-11-10T12:00:00.000Z',
  } as AnyMutationEnvelope;
  return {
    id: full.id,
    householdId: HOUSEHOLD,
    seq,
    envelope: full,
    state: 'pending',
    attempts: 0,
    createdAt: full.clientAt,
    dependsOn: [],
  };
}

function setup() {
  const server = new FakeServer({ now: () => Date.UTC(2026, 10, 10) });
  server.createHousehold(HOUSEHOLD, ALICE, 'Maison', PANTRY);
  const store = createSyncStore();
  store.setUser(ALICE);
  store.hydrate(HOUSEHOLD, [], [], 0);
  store.applyPage(server.pullChanges({ householdId: HOUSEHOLD, since: 0 }, ALICE));
  const create = entry(1, {
    id: P as unknown as MutationId,
    name: 'product.create',
    args: { productId: P, name: 'Pâtes' },
  } as never);
  const add = entry(2, {
    id: 'ffffffff-0000-4000-8000-000000000001' as MutationId,
    name: 'stock.add',
    args: { pantryId: PANTRY, productId: P, quantity: 2 },
  } as never);
  return { server, store, create, add };
}

const pull = (server: FakeServer, since: number): PullResponse =>
  server.pullChanges({ householdId: HOUSEHOLD, since }, ALICE);

describe('store', () => {
  it('applies a local mutation to the view and keeps unchanged maps', () => {
    const { store, create, add } = setup();
    const before = store.getSnapshot();
    store.applyLocal(create);
    store.applyLocal(add);
    const after = store.getSnapshot();
    expect(after.version).toBeGreaterThan(before.version);
    expect(after.rows.stock.get(stockKey(PANTRY, P))?.quantity).toBe(2);
    expect(after.rows.pantry).toBe(before.rows.pantry);
    expect(after.rows.category).toBe(before.rows.category);
    expect(after.overlay.map((e) => e.seq)).toEqual([1, 2]);
    expect(after.pendingKeys.has(`product/${P}`)).toBe(true);
  });

  it('notifies subscribers once per batch', () => {
    const { store, create, add } = setup();
    let calls = 0;
    const off = store.subscribe(() => {
      calls += 1;
    });
    store.batch(() => {
      store.applyLocal(create);
      store.applyLocal(add);
    });
    off();
    expect(calls).toBe(1);
  });

  it('rebases the overlay on a new base (concurrent withdrawal from another device)', () => {
    const { server, store, create, add } = setup();
    // The create and the add reach the server; another device then withdraws one.
    server.applyMutations(
      { householdId: HOUSEHOLD, deviceId: DEVICE, mutations: [create.envelope, add.envelope] },
      ALICE,
    );
    const cursor = store.getSnapshot().cursor;
    store.applyLocal(create);
    store.applyLocal(add);
    const remove = entry(3, {
      id: 'ffffffff-0000-4000-8000-000000000002' as MutationId,
      name: 'stock.remove',
      args: { pantryId: PANTRY, productId: P, quantity: 1, reason: 'consume' },
    } as never);
    store.applyLocal(remove);
    expect(store.getSnapshot().rows.stock.get(stockKey(PANTRY, P))?.quantity).toBe(1);
    // Acknowledged at the server head: kept in the overlay until a pull brings the cursor there.
    const head = server.state(HOUSEHOLD).head;
    store.updateEntries([
      { ...create, state: 'acked', ackedAtSyncId: head },
      { ...add, state: 'acked', ackedAtSyncId: head },
    ]);
    store.applyPage(pull(server, cursor));
    const snap = store.getSnapshot();
    expect(snap.overlay.map((e) => e.seq)).toEqual([3]);
    expect(snap.rows.stock.get(stockKey(PANTRY, P))?.quantity).toBe(1);
    expect(snap.rows.movement.get(add.id)?.seq).toBeLessThan(Infinity);
    expect(snap.rows.movement.get(remove.id)?.seq).toBe(Infinity);
  });

  it('drops the optimistic row of a create merged into another one at once', () => {
    const { store, create } = setup();
    store.applyLocal(create);
    store.updateEntries([
      {
        ...create,
        state: 'acked',
        ackedAtSyncId: 50,
        result: { id: create.id, status: 'applied', data: { canonicalId: 'x', merged: true, restored: false } },
      },
    ]);
    expect(store.getSnapshot().rows.product.has(P)).toBe(false);
  });

  it('a pull that changes nothing keeps every map identity', () => {
    const { server, store } = setup();
    const before = store.getSnapshot().rows;
    store.applyPage(pull(server, store.getSnapshot().cursor));
    const after = store.getSnapshot().rows;
    for (const k of Object.keys(before) as (keyof typeof before)[]) expect(after[k]).toBe(before[k]);
  });

  it('remap rewrites alias ids in the overlay', () => {
    const { store, add } = setup();
    const canonical = 'abababab-0000-4000-8000-000000000001' as ProductId;
    store.applyLocal(add);
    store.remap({ [P]: canonical });
    const e = store.getSnapshot().overlay[0];
    if (!e) throw new Error('missing entry');
    expect((e.envelope.args as { productId: string }).productId).toBe(canonical);
    expect(store.getSnapshot().aliases.get(P)).toBe(canonical);
  });
});

describe('hybrid clock', () => {
  it('is strictly increasing and lexicographically ordered', () => {
    let t = 1000;
    const clock = createHybridClock({ deviceId: DEVICE, now: () => t });
    const a = clock.next();
    const b = clock.next();
    t = 999; // the wall clock goes backwards
    const c = clock.next();
    t = 2000;
    const d = clock.next();
    expect([a, b, c, d]).toEqual([...[a, b, c, d]].sort());
    expect(new Set([a, b, c, d]).size).toBe(4);
    expect(parseHlc(c)).toMatchObject({ wall: 1000, counter: 2 });
    expect(a).toMatch(/^\d{15}\.\d{6}\.dddddddd-/);
  });

  it('observes remote HLCs and server time, and reports skew', () => {
    const t = 1_000_000;
    const clock = createHybridClock({ deviceId: DEVICE, now: () => t });
    clock.observe(formatHlc(5_000_000, 7, 'x') as Hlc);
    expect(parseHlc(clock.next())).toMatchObject({ wall: 5_000_000, counter: 9 });
    clock.observe(new Date(t + 400_000).toISOString());
    expect(clock.skewMs).toBe(-400_000);
  });
});
