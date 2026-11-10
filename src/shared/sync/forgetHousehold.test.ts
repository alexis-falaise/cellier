import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import type { PantryId, ProductId } from '@/domain/types';
import { openCellierDb } from '@/shared/db/cellierDb';
import { createManualEnvironment } from './environment';
import { forgetHousehold, getSyncStore, resetSyncSessionForTests, startSync, switchHousehold } from './session';
import { FakeServer } from './testing/fakeServer';
import { FakeTransport } from './testing/fakeTransport';
import { ALICE, HOUSEHOLD, OTHER_HOUSEHOLD, PANTRY } from './testing/fixtures';

const OTHER_PANTRY = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' as PantryId;
const PRODUCT = '99999999-0000-4000-8000-000000000001' as ProductId;

let counter = 0;

afterEach(() => {
  resetSyncSessionForTests();
});

async function setup() {
  const dbName = `forget-household-${++counter}`;
  const server = new FakeServer({ now: () => Date.UTC(2026, 10, 10, 12) });
  server.createHousehold(HOUSEHOLD, ALICE, 'Maison', PANTRY);
  server.createHousehold(OTHER_HOUSEHOLD, ALICE, 'Chalet', OTHER_PANTRY);
  const transport = new FakeTransport(server, ALICE);
  const options = { userId: ALICE, transport, environment: createManualEnvironment(), dbName };
  return { dbName, options };
}

describe('forgetHousehold', () => {
  it('closes the open household and deletes its local rows, outbox and cursor', async () => {
    const { dbName, options } = await setup();
    const engine = await startSync({ ...options, householdId: HOUSEHOLD });
    await engine.settle();
    // A pending mutation stays in the outbox (the manual environment never flushes on its own).
    engine.mutate('product.create', { productId: PRODUCT, name: 'Pâtes' });
    await engine.outbox.idle();

    const db = await openCellierDb(dbName);
    const before = await db.readHousehold(HOUSEHOLD);
    expect(before.rows.length).toBeGreaterThan(0);
    expect(await db.readCursor(HOUSEHOLD)).toBeGreaterThan(0);

    await forgetHousehold(HOUSEHOLD, { dbName });

    expect(engine.householdId).toBeNull();
    expect(getSyncStore().getSnapshot().householdId).toBeNull();
    const after = await db.readHousehold(HOUSEHOLD);
    expect(after.rows).toEqual([]);
    expect(after.outbox).toEqual([]);
    expect(await db.readCursor(HOUSEHOLD)).toBe(0);
    expect(await db.getMeta('active-household')).toBeNull();
    // The device id survives (mutation seq numbers stay monotonic).
    expect(await db.getMeta('device')).toBeDefined();
    db.close();
  });

  it('keeps the other households of the device', async () => {
    const { dbName, options } = await setup();
    const engine = await startSync({ ...options, householdId: OTHER_HOUSEHOLD });
    await engine.settle();
    await switchHousehold(HOUSEHOLD);
    await engine.settle();

    await forgetHousehold(OTHER_HOUSEHOLD, { dbName });

    // The open household is untouched.
    expect(engine.householdId).toBe(HOUSEHOLD);
    const db = await openCellierDb(dbName);
    expect((await db.readHousehold(OTHER_HOUSEHOLD)).rows).toEqual([]);
    expect((await db.readHousehold(HOUSEHOLD)).rows.length).toBeGreaterThan(0);
    expect(await db.getMeta('active-household')).toBe(HOUSEHOLD);
    db.close();
  });
});
