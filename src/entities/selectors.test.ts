import { describe, expect, it } from 'vitest';
import type {
  AnyMutationEnvelope,
  GroceryId,
  MutationArgs,
  MutationId,
  MutationName,
  PantryId,
  ProductId,
} from '@/domain/types';
import { formatHlc } from '@/shared/sync/hlc';
import { createdRowId } from '@/shared/sync/outbox';
import { createSyncStore } from '@/shared/sync/store';
import { FakeServer } from '@/shared/sync/testing/fakeServer';
import { ALICE, DEVICE, HOUSEHOLD, idGen, PANTRY } from '@/shared/sync/testing/fixtures';
import { selectOpenGroceryEntries } from './grocery';
import { selectMembers } from './member';
import { selectMovements } from './movement';
import { selectPantries, selectPantryStock } from './pantry';
import { selectLowProducts, selectProductView, selectProductViews } from './product';
import { selectAttentionGroups, selectSyncSummary } from './sync';

function setup() {
  const server = new FakeServer({ now: () => Date.UTC(2026, 10, 10) });
  server.createHousehold(HOUSEHOLD, ALICE, 'Maison', PANTRY);
  const store = createSyncStore();
  store.setUser(ALICE);
  store.hydrate(HOUSEHOLD, [], [], 0);
  store.applyPage(server.pullChanges({ householdId: HOUSEHOLD, since: 0 }, ALICE));
  const nextId = idGen('f');
  let seq = 0;
  const mutate = <N extends MutationName>(name: N, args: MutationArgs[N]) => {
    seq += 1;
    const envelope = {
      id: createdRowId({ name, args } as AnyMutationEnvelope) ?? nextId(),
      seq,
      name,
      args,
      hlc: formatHlc(1000 + seq, 0, DEVICE),
      clientAt: new Date(Date.UTC(2026, 10, 10, 0, 0, seq)).toISOString(),
    } as AnyMutationEnvelope;
    store.applyLocal({
      id: envelope.id,
      householdId: HOUSEHOLD,
      seq,
      envelope,
      state: 'pending',
      attempts: 0,
      createdAt: envelope.clientAt,
      dependsOn: [],
    });
    return envelope.id;
  };
  return { store, mutate, snap: () => store.getSnapshot() };
}

const A = 'a1a1a1a1-0000-4000-8000-000000000001' as ProductId;
const B = 'b2b2b2b2-0000-4000-8000-000000000002' as ProductId;

describe('entity selectors', () => {
  it('products with household totals over live pantries, sorted in French', () => {
    const { mutate, snap } = setup();
    const cave = 'c3c3c3c3-0000-4000-8000-000000000003' as PantryId;
    mutate('pantry.create', { pantryId: cave, name: 'Cave', sortOrder: 1 });
    mutate('product.create', { productId: A, name: 'Œufs', minQuantity: 2 });
    mutate('product.create', { productId: B, name: 'abricots' });
    mutate('stock.add', { pantryId: PANTRY, productId: A, quantity: 2 });
    mutate('stock.add', { pantryId: cave, productId: A, quantity: 3 });
    const views = selectProductViews(snap());
    expect(views.map((v) => v.product.name)).toEqual(['abricots', 'Œufs']);
    const a = selectProductView(A)(snap());
    expect(a).toMatchObject({ totalQuantity: 5, pending: true });
    expect(a?.perPantry.map((p) => p.pantryId)).toEqual([PANTRY, cave]);
    mutate('pantry.delete', { pantryId: cave });
    expect(selectProductView(A)(snap())?.totalQuantity).toBe(2);
    expect(selectLowProducts(snap()).map((v) => v.product.id)).toEqual([B, A]);
    expect(selectPantries(snap()).map((p) => p.id)).toEqual([PANTRY]);
  });

  it('returns referentially stable results when nothing they read changed', () => {
    const { mutate, snap } = setup();
    mutate('product.create', { productId: A, name: 'Pâtes' });
    mutate('product.create', { productId: B, name: 'Riz' });
    mutate('stock.add', { pantryId: PANTRY, productId: A, quantity: 1 });
    const s1 = snap();
    const views1 = selectProductViews(s1);
    const stock1 = selectPantryStock(PANTRY)(s1);
    const members1 = selectMembers(s1);
    expect(selectProductViews(s1)).toBe(views1);

    // Unrelated change: a grocery entry. Products, pantry stock and members keep their identity.
    mutate('grocery.add', { groceryId: 'd4d4d4d4-0000-4000-8000-000000000004' as GroceryId, label: 'Piles' });
    const s2 = snap();
    expect(s2).not.toBe(s1);
    expect(selectProductViews(s2)).toBe(views1);
    expect(selectPantryStock(PANTRY)(s2)).toBe(stock1);
    expect(selectMembers(s2)).toBe(members1);
    expect(selectOpenGroceryEntries(s2)).toHaveLength(1);

    // Stock change on A: the list changes, B's view object does not.
    mutate('stock.add', { pantryId: PANTRY, productId: A, quantity: 1 });
    const views3 = selectProductViews(snap());
    expect(views3).not.toBe(views1);
    expect(views3.find((v) => v.product.id === B)).toBe(views1.find((v) => v.product.id === B));
    expect(views3.find((v) => v.product.id === A)?.totalQuantity).toBe(2);
  });

  it('lists pending movements first', () => {
    const { mutate, snap, store } = setup();
    mutate('product.create', { productId: A, name: 'Lait' });
    const id = mutate('stock.add', { pantryId: PANTRY, productId: A, quantity: 1 });
    const list = selectMovements(snap());
    expect(list[0]).toMatchObject({ pending: true, movement: { id } });
    expect(selectSyncSummary(snap())).toBe(selectSyncSummary(store.getSnapshot()));
    expect(selectSyncSummary(snap()).pendingCount).toBe(2);
  });

  it('groups attention entries under their failed parent', () => {
    const { store, mutate, snap } = setup();
    const g = 'e5e5e5e5-0000-4000-8000-000000000005' as GroceryId;
    mutate('product.create', { productId: A, name: 'Thé' });
    const add = mutate('grocery.add', { groceryId: g, productId: A });
    const upd = mutate('grocery.update', { groceryId: g, fields: { quantity: 2 } });
    const [, e2, e3] = snap().overlay;
    if (!e2 || !e3) throw new Error('missing entries');
    store.updateEntries([
      { ...e2, state: 'attention', attentionReason: 'gone' },
      { ...e3, state: 'attention', attentionReason: 'dependency_failed', dependsOn: [add as MutationId] },
    ]);
    const groups = selectAttentionGroups(snap());
    expect(groups).toHaveLength(1);
    expect(groups[0]?.entry.id).toBe(add);
    expect(groups[0]?.dependents.map((d) => d.id)).toEqual([upd]);
    expect(selectSyncSummary(snap()).attention).toHaveLength(2);
  });
});
