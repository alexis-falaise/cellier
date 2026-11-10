import { describe, expect, it } from 'vitest';
import type {
  AnyMutationEnvelope,
  CategoryId,
  EntityName,
  GroceryId,
  Gtin,
  MovementId,
  MutationArgs,
  MutationErrorCode,
  MutationName,
  PantryId,
  ProductId,
} from '@/domain/types';
import { stockKey } from '@/domain/types';
import type { OutboxEntry } from './contract';
import { formatHlc } from './hlc';
import { createdRowId } from './outbox';
import { MUTATION_NAMES, validateMutation } from './reducers';
import { createSyncStore } from './store';
import { FakeServer } from './testing/fakeServer';
import { ALICE, DEVICE, HOUSEHOLD, idGen, normalizeRows, PANTRY, pick, seeded } from './testing/fixtures';

const COMPARED: EntityName[] = ['household', 'member', 'pantry', 'category', 'product', 'stock', 'movement', 'grocery'];

function setup() {
  let t = Date.UTC(2026, 10, 10, 12);
  const now = () => t;
  const server = new FakeServer({ now });
  server.createHousehold(HOUSEHOLD, ALICE, 'Maison', PANTRY);
  const store = createSyncStore();
  store.setUser(ALICE);
  store.hydrate(HOUSEHOLD, [], [], 0);
  store.applyPage(server.pullChanges({ householdId: HOUSEHOLD, since: 0 }, ALICE));
  const nextId = idGen('e');
  let seq = 0;
  const history: unknown[] = [];

  /** Applies a mutation locally (optimistic) and on the server, like a device that is always online. */
  function run<N extends MutationName>(
    name: N,
    args: MutationArgs[N],
    options: { serverToo?: boolean } = {},
  ): { code: MutationErrorCode | null; envelope?: AnyMutationEnvelope; result?: unknown } {
    const code = validateMutation(name, args, store.reader());
    if (code) return { code };
    seq += 1;
    t += 1000;
    const draftEnvelope = { name, args } as AnyMutationEnvelope;
    const envelope = {
      id: createdRowId(draftEnvelope) ?? nextId(),
      seq,
      name,
      args,
      hlc: formatHlc(t, 0, DEVICE),
      clientAt: new Date(t).toISOString(),
    } as AnyMutationEnvelope;
    const entry: OutboxEntry = {
      id: envelope.id,
      householdId: HOUSEHOLD,
      seq,
      envelope,
      state: 'pending',
      attempts: 0,
      createdAt: envelope.clientAt,
      dependsOn: [],
    };
    store.applyLocal(entry);
    if (options.serverToo === false) return { code: null, envelope };
    const response = server.applyMutations({ householdId: HOUSEHOLD, deviceId: DEVICE, mutations: [envelope] }, ALICE);
    history.push({ name, args, result: response.results[0] });
    return { code: null, envelope, result: response.results[0] };
  }

  function expectViewMatchesServer() {
    const rows = store.getSnapshot().rows;
    for (const entity of COMPARED) {
      expect(normalizeRows(entity, rows[entity].values()), `${entity} after ${JSON.stringify(history.at(-1))}`).toEqual(
        normalizeRows(entity, server.rows(HOUSEHOLD, entity)),
      );
    }
  }

  return { server, store, run, nextId, expectViewMatchesServer };
}

const P = (id: string) => id as ProductId;

describe('reducers predict the server without concurrency', () => {
  it('covers every mutation name', () => {
    expect(MUTATION_NAMES).toHaveLength(23);
  });

  it('stock.add creates the stock row and a pending movement with the source', () => {
    const { run, store, nextId, expectViewMatchesServer } = setup();
    const productId = P(nextId());
    run('product.create', { productId, name: 'Pâtes' });
    const { envelope } = run('stock.add', { pantryId: PANTRY, productId, quantity: 3, source: 'scan' });
    const snap = store.getSnapshot();
    expect(snap.rows.stock.get(stockKey(PANTRY, productId))?.quantity).toBe(3);
    const mv = snap.rows.movement.get(envelope?.id as string);
    expect(mv).toMatchObject({ kind: 'restock', appliedDelta: 3, quantityAfter: 3, source: 'scan', seq: Infinity });
    expectViewMatchesServer();
  });

  it('stock.remove floors at zero like the server clamp', () => {
    const { run, store, nextId, expectViewMatchesServer } = setup();
    const productId = P(nextId());
    run('product.create', { productId, name: 'Riz' });
    run('stock.add', { pantryId: PANTRY, productId, quantity: 1 });
    const { result } = run('stock.remove', { pantryId: PANTRY, productId, quantity: 2, reason: 'consume' });
    expect(result).toMatchObject({ status: 'clamped', data: { requested: -2, applied: -1, quantityAfter: 0 } });
    expect(store.getSnapshot().rows.stock.get(stockKey(PANTRY, productId))?.quantity).toBe(0);
    expectViewMatchesServer();
  });

  it('stock.recount, stock.transfer and stock.revert (including a transfer) match', () => {
    const { run, nextId, expectViewMatchesServer } = setup();
    const productId = P(nextId());
    const cave = nextId() as PantryId;
    run('product.create', { productId, name: 'Vin' });
    run('pantry.create', { pantryId: cave, name: 'Cave' });
    const add = run('stock.add', { pantryId: PANTRY, productId, quantity: 5 });
    run('stock.recount', { pantryId: PANTRY, productId, counted: 4 });
    const move = run('stock.transfer', { fromPantryId: PANTRY, toPantryId: cave, productId, quantity: 6 });
    expect(move.result).toMatchObject({ status: 'clamped', data: { requested: 6, applied: 4 } });
    expectViewMatchesServer();
    run('stock.revert', { movementId: move.envelope?.id as unknown as MovementId });
    expectViewMatchesServer();
    expect(run('stock.revert', { movementId: move.envelope?.id as unknown as MovementId }).code).toBe(
      'already_reverted',
    );
    run('stock.revert', { movementId: add.envelope?.id as unknown as MovementId });
    expectViewMatchesServer();
  });

  it('natural keys: product by GTIN, pantry by normalised name, open grocery entry by product', () => {
    const { run, store, nextId, expectViewMatchesServer } = setup();
    const gtin = '03017620422003' as Gtin;
    const first = P(nextId());
    run('product.create', { productId: first, name: 'Nutella', gtin });
    run('product.delete', { productId: first });
    // Same GTIN on a tombstone: revived, empty fields filled, no new row.
    run('product.create', { productId: P(nextId()), name: 'Nutella 400g', gtin, brand: 'Ferrero' });
    expect(store.getSnapshot().rows.product.get(first)).toMatchObject({ deletedAt: null, brand: 'Ferrero' });
    run('pantry.create', { pantryId: nextId() as PantryId, name: 'Garage' });
    run('pantry.create', { pantryId: nextId() as PantryId, name: '  garage ', icon: 'car' });
    run('grocery.add', { groceryId: nextId() as GroceryId, productId: first });
    run('grocery.add', { groceryId: nextId() as GroceryId, productId: first, quantity: 2 });
    expect([...store.getSnapshot().rows.grocery.values()]).toHaveLength(1);
    expectViewMatchesServer();
  });

  it('client validation mirrors server rejections', () => {
    const { run, nextId } = setup();
    const productId = P(nextId());
    run('product.create', { productId, name: 'Lait' });
    run('product.create', { productId: P(nextId()), name: 'Beurre' });
    expect(run('product.update', { productId, fields: { name: 'beurre' } }).code).toBe('name_taken');
    expect(run('stock.add', { pantryId: PANTRY, productId, quantity: 0 }).code).toBe('validation');
    expect(run('stock.remove', { pantryId: PANTRY, productId, quantity: 1, reason: 'lost' as never }).code).toBe(
      'validation',
    );
    expect(run('stock.transfer', { fromPantryId: PANTRY, toPantryId: PANTRY, productId, quantity: 1 }).code).toBe(
      'validation',
    );
    expect(run('grocery.add', { groceryId: nextId() as GroceryId, productId, label: 'x' }).code).toBe('validation');
    run('product.delete', { productId });
    expect(run('stock.add', { pantryId: PANTRY, productId, quantity: 1 }).code).toBe('not_found');
    expect(run('product.update', { productId, fields: { priceCents: 100 } }).code).toBe('not_found');
  });

  it('grocery.update: checking sets checkedAt/checkedBy and never touches stock', () => {
    const { run, store, nextId, expectViewMatchesServer } = setup();
    const productId = P(nextId());
    run('product.create', { productId, name: 'Oeufs' });
    run('stock.add', { pantryId: PANTRY, productId, quantity: 2 });
    const groceryId = nextId() as GroceryId;
    run('grocery.add', { groceryId, productId });
    const before = store.getSnapshot().rows.stock;
    run('grocery.update', { groceryId, fields: { checked: true, quantity: 3 } });
    const snap = store.getSnapshot();
    expect(snap.rows.grocery.get(groceryId)).toMatchObject({ checkedBy: ALICE, quantity: 3 });
    expect(snap.rows.stock).toBe(before);
    expectViewMatchesServer();
  });

  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`random sequence ${seed}: the optimistic view equals the server outcome`, () => {
      const { run, store, nextId, expectViewMatchesServer } = setup();
      const random = seeded(seed);
      const names = ['Pâtes', 'pates', 'Riz', 'Lait', 'Café', 'Thé'];
      const gtins = ['03017620422003', '03228857000166', null];
      const pantryNames = ['Cave', 'Frigo', 'cave', 'Garage'];
      const view = () => store.getSnapshot().rows;
      const ids = <E extends EntityName>(e: E) => [...view()[e].keys()];
      const ops: Array<() => void> = [
        () => {
          const gtin = pick(random, gtins) ?? null;
          run('product.create', {
            productId: P(nextId()),
            name: pick(random, names) ?? 'X',
            ...(gtin ? { gtin: gtin as Gtin } : {}),
            ...(random() < 0.5 ? { minQuantity: Math.floor(random() * 4) } : {}),
          });
        },
        () => run('pantry.create', { pantryId: nextId() as PantryId, name: pick(random, pantryNames) ?? 'P' }),
        () =>
          run('category.create', {
            categoryId: nextId() as CategoryId,
            name: pick(random, ['Épices', 'epices', 'Bébé']) ?? 'C',
          }),
        () => {
          const productId = pick(random, ids('product'));
          if (!productId) return;
          const category = pick(random, [...ids('category'), null]);
          run('product.update', {
            productId: P(productId),
            fields: {
              ...(random() < 0.3 ? { name: pick(random, names) ?? 'Y' } : {}),
              ...(random() < 0.5 ? { priceCents: Math.floor(random() * 500) } : {}),
              ...(random() < 0.3 ? { categoryId: (category ?? null) as CategoryId | null } : {}),
              ...(random() < 0.2 ? { lowAlert: random() < 0.5 } : {}),
            },
          });
        },
        () => {
          const pantryId = pick(random, ids('pantry'));
          if (pantryId)
            run('pantry.update', { pantryId: pantryId as PantryId, fields: { sortOrder: Math.floor(random() * 9) } });
        },
        () => {
          const productId = pick(random, ids('product'));
          if (productId) run(random() < 0.5 ? 'product.delete' : 'product.restore', { productId: P(productId) });
        },
        () => {
          const pantryId = pick(random, ids('pantry'));
          if (pantryId && pantryId !== PANTRY)
            run(random() < 0.5 ? 'pantry.delete' : 'pantry.restore', { pantryId: pantryId as PantryId });
        },
        ...[0, 1, 2].map(() => () => {
          const productId = pick(random, ids('product'));
          const pantryId = pick(random, ids('pantry'));
          if (!productId || !pantryId) return;
          const q = 1 + Math.floor(random() * 4);
          const r = random();
          if (r < 0.35)
            run('stock.add', { pantryId: pantryId as PantryId, productId: P(productId), quantity: q, source: 'scan' });
          else if (r < 0.7)
            run('stock.remove', {
              pantryId: pantryId as PantryId,
              productId: P(productId),
              quantity: q,
              reason: random() < 0.8 ? 'consume' : 'discard',
            });
          else if (r < 0.85)
            run('stock.recount', { pantryId: pantryId as PantryId, productId: P(productId), counted: q });
          else {
            const to = pick(random, ids('pantry'));
            if (to)
              run('stock.transfer', {
                fromPantryId: pantryId as PantryId,
                toPantryId: to as PantryId,
                productId: P(productId),
                quantity: q,
              });
          }
        }),
        () => {
          const movementId = pick(
            random,
            ids('movement').filter((id) => !id.includes('~')),
          );
          if (movementId) run('stock.revert', { movementId: movementId as MovementId });
        },
        () => {
          const productId = pick(random, ids('product'));
          if (productId && random() < 0.7)
            run('grocery.add', { groceryId: nextId() as GroceryId, productId: P(productId) });
          else run('grocery.add', { groceryId: nextId() as GroceryId, label: 'Piles', quantity: 2 });
        },
        () => {
          const groceryId = pick(random, ids('grocery'));
          if (!groceryId) return;
          const r = random();
          if (r < 0.4)
            run('grocery.update', { groceryId: groceryId as GroceryId, fields: { checked: random() < 0.7 } });
          else if (r < 0.6) run('grocery.update', { groceryId: groceryId as GroceryId, fields: { dismissed: true } });
          else if (r < 0.8)
            run('grocery.update', {
              groceryId: groceryId as GroceryId,
              fields: { quantity: 1 + Math.floor(random() * 5) },
            });
          else run(random() < 0.5 ? 'grocery.delete' : 'grocery.restore', { groceryId: groceryId as GroceryId });
        },
        () => run('household.rename', { name: pick(random, ['Maison', 'Chez nous']) ?? 'M' }),
        () => run('member.updateSelf', { displayName: 'Alice', notifyDigest: random() < 0.5 }),
      ];
      for (let i = 0; i < 150; i += 1) {
        (pick(random, ops) as () => void)();
        expectViewMatchesServer();
      }
      expectViewMatchesServer();
    });
  }
});
