import { describe, expect, it } from 'vitest';
import type { Category, CategoryId, Gtin, PantryId, ProductId } from '@/domain/types';
import type { CatalogProduct } from '@/features/catalogue';
import { computeCheckDigit, parseBarcode, type ScannedCode } from '@/shared/lib/gtin';
import { looksLikeBarcode, parsePriceCents, parseSize } from './entry';
import {
  type CommitContext,
  committableUnits,
  type EvalContext,
  evaluateRow,
  initialTrayState,
  planCommit,
  type TrayAction,
  type TrayState,
  trayReducer,
} from './tray';

const ean = (body12: string) => `${body12}${computeCheckDigit(body12)}`;
const code = (raw: string): ScannedCode => {
  const parsed = parseBarcode(raw);
  if (!parsed.ok) throw new Error(`invalid test code ${raw}`);
  return parsed.code;
};

const NUTELLA = code('3017620422003');
const COLA = code(ean('544900000099'));
const STORE = code(ean('212345600123'));

const CAVE = 'p-cave' as PantryId;
const GARAGE = 'p-garage' as PantryId;
const RIZ = 'prod-riz' as ProductId;
const AUTRE = 'cat-autre' as CategoryId;

const CATEGORIES: Pick<Category, 'id' | 'templateKey' | 'deletedAt'>[] = [
  { id: AUTRE, templateKey: 'autre', deletedAt: null },
  { id: 'cat-petit-dej' as CategoryId, templateKey: 'petit_dej', deletedAt: null },
];

const catalogProduct = (gtin: string): CatalogProduct => ({
  gtin: gtin as Gtin,
  name: 'Pâte à tartiner',
  brand: 'Nutella',
  quantityLabel: '400 g',
  netQuantity: 400,
  netUnit: 'g',
  packCount: 1,
  categoryKey: 'petit_dej',
  categoryRule: null,
  imageUrl: null,
  source: 'off',
  storeTags: [],
  popularity: 1,
  priceCents: 389,
  priceObservedOn: '2026-10-01',
  priceChain: 'carrefour',
  sourceModifiedAt: null,
});

function run(...actions: TrayAction[]): TrayState {
  return actions.reduce(trayReducer, initialTrayState);
}

function ctx(
  mode: 'add' | 'withdraw',
  stock: Record<string, number> = {},
  pantryId: PantryId | null = CAVE,
): CommitContext {
  let n = 0;
  const pantries = [CAVE, GARAGE];
  const stockOf = (productId: ProductId, pantry: PantryId) => stock[`${pantry}:${productId}`] ?? 0;
  return {
    mode,
    pantryId,
    stockOf,
    holdings: (productId) =>
      pantries.map((p) => ({ pantryId: p, quantity: stockOf(productId, p) })).filter((h) => h.quantity > 0),
    categories: CATEGORIES,
    newProductId: () => `new-${++n}` as ProductId,
    now: Date.parse('2026-11-10T12:00:00Z'),
    unnamedLabel: 'Article sans nom',
  };
}

describe('scan tray: add mode', () => {
  it('adds a known household product synchronously and logs a restock with source scan', () => {
    const state = run({ type: 'detected', code: NUTELLA, known: { productId: RIZ, deleted: false } });
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]?.status).toEqual({ kind: 'household', productId: RIZ, deleted: false });
    expect(state.recognitions).toBe(1);

    const plan = planCommit(state.rows, ctx('add', { [`${CAVE}:${RIZ}`]: 2 }));
    expect(plan.skipped).toBe(0);
    expect(plan.steps).toEqual([
      {
        rowId: state.rows[0]?.id,
        create: null,
        restore: null,
        stock: { name: 'stock.add', args: { pantryId: CAVE, productId: RIZ, quantity: 1, source: 'scan' } },
      },
    ]);
  });

  it('starts a lookup for an unknown code and creates the catalogue product before its restock', () => {
    let state = run({ type: 'detected', code: NUTELLA });
    const rowId = state.rows[0]?.id as string;
    expect(state.rows[0]?.status.kind).toBe('searching');
    expect(planCommit(state.rows, ctx('add')).steps).toHaveLength(0); // searching is not committable

    const gtin = (NUTELLA as { gtin14: string }).gtin14;
    state = trayReducer(state, {
      type: 'resolved',
      rowId,
      outcome: { kind: 'found_online', gtin: gtin as Gtin, product: catalogProduct(gtin) },
    });
    const plan = planCommit(state.rows, ctx('add'));
    expect(plan.steps).toHaveLength(1);
    const step = plan.steps[0];
    expect(step?.create).toMatchObject({
      productId: 'new-1',
      name: 'Pâte à tartiner',
      gtin,
      catalogGtin: gtin,
      netQuantity: 400,
      netUnit: 'g',
      priceCents: 389,
      priceSource: 'catalog',
      categoryId: 'cat-petit-dej',
    });
    expect(step?.stock).toEqual({
      name: 'stock.add',
      args: { pantryId: CAVE, productId: 'new-1', quantity: 1, source: 'scan' },
    });
  });

  it('ignores a lookup answer for a row that was removed (stale lookup)', () => {
    let state = run({ type: 'detected', code: NUTELLA });
    const rowId = state.rows[0]?.id as string;
    state = trayReducer(state, { type: 'remove', rowId });
    const after = trayReducer(state, {
      type: 'resolved',
      rowId,
      outcome: { kind: 'not_found', gtin: 'x' as Gtin, draft: null },
    });
    expect(after).toBe(state);
  });

  it('restores a tombstoned household product before adding stock', () => {
    const state = run({ type: 'detected', code: NUTELLA, known: { productId: RIZ, deleted: true } });
    const plan = planCommit(state.rows, ctx('add'));
    expect(plan.steps[0]?.restore).toBe(RIZ);
  });

  it('skips everything when there is no cellier yet', () => {
    const state = run({ type: 'detected', code: NUTELLA, known: { productId: RIZ, deleted: false } });
    expect(planCommit(state.rows, ctx('add', {}, null))).toEqual({ steps: [], skipped: 1 });
  });
});

describe('scan tray: duplicates', () => {
  it('increments the row and moves it to the top instead of adding a second row', () => {
    const state = run(
      { type: 'detected', code: NUTELLA },
      { type: 'detected', code: COLA },
      { type: 'detected', code: NUTELLA },
    );
    expect(state.rows).toHaveLength(2);
    expect(state.rows[0]?.digits).toBe('3017620422003');
    expect(state.rows[0]?.quantity).toBe(2);
    expect(state.recognitions).toBe(3);
  });

  it('merges a code that resolves to a product already in the tray', () => {
    let state = run({ type: 'picked', productId: RIZ }, { type: 'detected', code: COLA });
    const rowId = state.rows[0]?.id as string;
    state = trayReducer(state, {
      type: 'resolved',
      rowId,
      outcome: { kind: 'found_household', gtin: 'x' as Gtin, productId: RIZ, restoredFromTombstone: false },
    });
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]?.quantity).toBe(2);
  });

  it('commits one movement per row with the stepper quantity (never twice)', () => {
    let state = run({ type: 'detected', code: NUTELLA, known: { productId: RIZ, deleted: false } });
    const rowId = state.rows[0]?.id as string;
    state = trayReducer(state, { type: 'detected', code: NUTELLA, known: { productId: RIZ, deleted: false } });
    state = trayReducer(state, { type: 'setQuantity', rowId, quantity: 12 });
    const plan = planCommit(state.rows, ctx('add'));
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.stock.args.quantity).toBe(12);
  });

  it('keeps quantities as integers between 1 and 9999', () => {
    let state = run({ type: 'detected', code: NUTELLA });
    const rowId = state.rows[0]?.id as string;
    state = trayReducer(state, { type: 'setQuantity', rowId, quantity: 2.7 });
    expect(state.rows[0]?.quantity).toBe(2);
    state = trayReducer(state, { type: 'setQuantity', rowId, quantity: 1e9 });
    expect(state.rows[0]?.quantity).toBe(9999);
  });
});

describe('scan tray: withdraw mode', () => {
  const known = { productId: RIZ, deleted: false };

  it('clamps the withdrawal to the stock of the tray cellier and logs a consume', () => {
    let state = run({ type: 'detected', code: NUTELLA, known });
    const rowId = state.rows[0]?.id as string;
    state = trayReducer(state, { type: 'setQuantity', rowId, quantity: 5 });
    const c = ctx('withdraw', { [`${CAVE}:${RIZ}`]: 3 });
    expect(evaluateRow(state.rows[0] as never, c)).toEqual({
      kind: 'withdraw',
      productId: RIZ,
      pantryId: CAVE,
      max: 3,
    });
    expect(committableUnits(state.rows, c)).toBe(3);
    expect(planCommit(state.rows, c).steps[0]?.stock).toEqual({
      name: 'stock.remove',
      args: { pantryId: CAVE, productId: RIZ, quantity: 3, reason: 'consume', source: 'scan' },
    });
  });

  it('shows the other cellier when the product is only there, and withdraws from it once chosen', () => {
    let state = run({ type: 'detected', code: NUTELLA, known });
    const c = ctx('withdraw', { [`${GARAGE}:${RIZ}`]: 4 });
    expect(evaluateRow(state.rows[0] as never, c)).toEqual({
      kind: 'elsewhere',
      productId: RIZ,
      other: GARAGE,
      quantity: 4,
    });
    expect(planCommit(state.rows, c)).toEqual({ steps: [], skipped: 1 });

    state = trayReducer(state, { type: 'setSource', rowId: state.rows[0]?.id as string, pantryId: GARAGE });
    expect(planCommit(state.rows, c).steps[0]?.stock.args).toMatchObject({ pantryId: GARAGE, quantity: 1 });
  });

  it('marks a product that is not in stock, or unknown to the household, as absent and skips it', () => {
    let state = run({ type: 'detected', code: NUTELLA, known }, { type: 'detected', code: COLA });
    const colaId = state.rows[0]?.id as string;
    state = trayReducer(state, {
      type: 'resolved',
      rowId: colaId,
      outcome: { kind: 'not_found', gtin: 'x' as Gtin, draft: null },
    });
    const c = ctx('withdraw');
    expect(state.rows.map((r) => evaluateRow(r, c).kind)).toEqual(['absent', 'absent']);
    expect(planCommit(state.rows, c)).toEqual({ steps: [], skipped: 2 });
  });

  it('re-evaluates rows when the mode switches, without changing them', () => {
    const state = run({ type: 'detected', code: NUTELLA, known });
    expect(evaluateRow(state.rows[0] as never, ctx('withdraw')).kind).toBe('absent');
    expect(evaluateRow(state.rows[0] as never, ctx('add')).kind).toBe('add');
  });
});

describe('scan tray: unknown and in-store codes', () => {
  it('saves a product found nowhere as «Article sans nom» with its barcode and the draft details', () => {
    let state = run({ type: 'detected', code: COLA });
    state = trayReducer(state, {
      type: 'resolved',
      rowId: state.rows[0]?.id as string,
      outcome: { kind: 'not_found', gtin: 'x' as Gtin, draft: { brand: 'Coca', netQuantity: 330, netUnit: 'ml' } },
    });
    const step = planCommit(state.rows, ctx('add')).steps[0];
    expect(step?.create).toMatchObject({
      name: 'Article sans nom',
      gtin: (COLA as { gtin14: string }).gtin14,
      brand: 'Coca',
      netQuantity: 330,
      netUnit: 'ml',
      categoryId: AUTRE,
    });
  });

  it('uses the name, category, size and price from the unknown-product sheet', () => {
    let state = run({ type: 'detected', code: COLA });
    const rowId = state.rows[0]?.id as string;
    state = trayReducer(state, {
      type: 'resolved',
      rowId,
      outcome: { kind: 'not_found', gtin: 'x' as Gtin, draft: null },
    });
    state = trayReducer(state, {
      type: 'name',
      rowId,
      input: { name: 'Soda', categoryId: AUTRE, netQuantity: 330, netUnit: 'ml', priceCents: 129 },
    });
    expect(planCommit(state.rows, ctx('add')).steps[0]?.create).toMatchObject({
      name: 'Soda',
      categoryId: AUTRE,
      netQuantity: 330,
      netUnit: 'ml',
      priceCents: 129,
      priceSource: 'user',
    });
  });

  it('sends an in-store code straight to manual entry: no lookup, not committable, no barcode stored', () => {
    let state = run({ type: 'detected', code: STORE });
    expect(STORE.kind).toBe('variable-measure');
    expect(state.rows[0]?.status.kind).toBe('store-code');
    expect(state.rows[0]?.gtin).toBeNull();
    expect(planCommit(state.rows, ctx('add'))).toEqual({ steps: [], skipped: 1 });

    const rowId = state.rows[0]?.id as string;
    state = trayReducer(state, {
      type: 'name',
      rowId,
      input: { name: 'Comté', categoryId: AUTRE, netQuantity: null, netUnit: null, priceCents: null },
    });
    const step = planCommit(state.rows, ctx('add')).steps[0];
    expect(step?.create).toMatchObject({ name: 'Comté', gtin: null });
  });

  it('turns an in-store code row into the household product chosen for it', () => {
    let state = run({ type: 'detected', code: STORE });
    state = trayReducer(state, { type: 'picked', productId: RIZ, rowId: state.rows[0]?.id });
    expect(state.rows[0]?.status).toEqual({ kind: 'household', productId: RIZ, deleted: false });
  });
});

describe('scan tray: offline', () => {
  it('keeps an offline code committable as a placeholder product with its barcode', () => {
    let state = run({ type: 'detected', code: NUTELLA });
    const rowId = state.rows[0]?.id as string;
    state = trayReducer(state, { type: 'resolved', rowId, outcome: { kind: 'offline', gtin: 'x' as Gtin } });
    expect(state.rows[0]?.status.kind).toBe('offline');
    const step = planCommit(state.rows, ctx('add')).steps[0];
    expect(step?.create).toMatchObject({
      name: 'Article sans nom',
      gtin: (NUTELLA as { gtin14: string }).gtin14,
      categoryId: AUTRE,
    });
  });

  it('looks an offline row up again when asked (connection back)', () => {
    let state = run({ type: 'detected', code: NUTELLA });
    const rowId = state.rows[0]?.id as string;
    state = trayReducer(state, { type: 'resolved', rowId, outcome: { kind: 'offline', gtin: 'x' as Gtin } });
    state = trayReducer(state, { type: 'retry', rowId });
    expect(state.rows[0]?.status.kind).toBe('searching');
  });
});

describe('scan tray: undo', () => {
  it('removes a row and puts it back where it was', () => {
    let state = run({ type: 'detected', code: NUTELLA }, { type: 'detected', code: COLA });
    const removedId = state.rows[1]?.id as string;
    state = trayReducer(state, { type: 'remove', rowId: removedId });
    expect(state.rows).toHaveLength(1);
    expect(state.removed?.row.id).toBe(removedId);
    state = trayReducer(state, { type: 'undoRemove' });
    expect(state.rows.map((r) => r.id)[1]).toBe(removedId);
    expect(state.removed).toBeNull();
  });

  it('removes the row when the stepper goes below 1', () => {
    let state = run({ type: 'detected', code: NUTELLA });
    state = trayReducer(state, { type: 'setQuantity', rowId: state.rows[0]?.id as string, quantity: 0 });
    expect(state.rows).toHaveLength(0);
    expect(state.removed).not.toBeNull();
  });

  it('merges the restored row into a row of the same code scanned meanwhile', () => {
    let state = run({ type: 'detected', code: NUTELLA });
    state = trayReducer(state, { type: 'remove', rowId: state.rows[0]?.id as string });
    state = trayReducer(state, { type: 'detected', code: NUTELLA });
    state = trayReducer(state, { type: 'undoRemove' });
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]?.quantity).toBe(2);
  });
});

describe('scan tray: draft restore', () => {
  it('restores rows and keeps new ids unique', () => {
    const previous = run({ type: 'detected', code: NUTELLA }, { type: 'detected', code: COLA });
    let state = trayReducer(initialTrayState, { type: 'restore', rows: previous.rows });
    state = trayReducer(state, { type: 'detected', code: STORE });
    const ids = state.rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(3);
  });
});

describe('unknown-product fields', () => {
  it('reads sizes in g, kg, cl, L and pieces', () => {
    expect(parseSize('500 g')).toEqual({ netQuantity: 500, netUnit: 'g' });
    expect(parseSize('1,5 kg')).toEqual({ netQuantity: 1500, netUnit: 'g' });
    expect(parseSize('75cl')).toEqual({ netQuantity: 750, netUnit: 'ml' });
    expect(parseSize('2 L')).toEqual({ netQuantity: 2000, netUnit: 'ml' });
    expect(parseSize('6')).toEqual({ netQuantity: 6, netUnit: 'piece' });
    expect(parseSize('')).toBeNull();
    expect(parseSize('beaucoup')).toBe('invalid');
    expect(parseSize('0 g')).toBe('invalid');
  });

  it('reads prices in euros as cents', () => {
    expect(parsePriceCents('2,49')).toBe(249);
    expect(parsePriceCents('2.5 €')).toBe(250);
    expect(parsePriceCents('3')).toBe(300);
    expect(parsePriceCents('')).toBeNull();
    expect(parsePriceCents('-1')).toBe('invalid');
  });

  it('tells barcodes from names in the manual entry', () => {
    expect(looksLikeBarcode('3017 6204 22003')).toBe(true);
    expect(looksLikeBarcode('Riz basmati')).toBe(false);
  });
});

// The EvalContext type is part of the public surface used by the UI.
const _typecheck: EvalContext = ctx('add');
void _typecheck;
