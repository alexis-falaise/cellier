/**
 * Scan flow state (design 03 §4.4): the tray of a scanner session, as a pure reducer plus pure helpers that
 * evaluate each row for the current mode and plan the commit. No React, no store, no network: the hook in
 * `useScanFlow.ts` feeds detections and lookup outcomes in and executes the plan with `mutate`.
 *
 * Rows are a draft: nothing is written until «Terminer», which commits one stock mutation per row (product
 * creations first, source `scan`). A repeated code increments its row instead of adding one, so a code can
 * never be logged twice.
 */
import type { Category, CategoryId, Gtin, MutationArgs, NetUnit, PantryId, ProductId } from '@/domain/types';
import {
  type CatalogLookupDraft,
  type CatalogProduct,
  catalogueToProductCreate,
  resolveHouseholdCategory,
  type ScanOutcome,
} from '@/features/catalogue';
import type { ScannedCode } from '@/shared/lib/gtin';

export type ScanMode = 'add' | 'withdraw';

export const MAX_QUANTITY = 9999;

/** What the unknown-product sheet produces. */
export interface NewProductInput {
  name: string;
  categoryId: CategoryId | null;
  netQuantity: number | null;
  netUnit: NetUnit | null;
  priceCents: number | null;
}

export type RowStatus =
  /** Code read, lookup running («Recherche…»). */
  | { kind: 'searching' }
  /** A product of the household (tombstoned ones are restored at commit). */
  | { kind: 'household'; productId: ProductId; deleted: boolean }
  /** Found in `catalog_products` or online through the Edge Function: new to the household. */
  | { kind: 'catalogue'; product: CatalogProduct; origin: 'catalogue' | 'online' }
  /** Offline and unknown locally: saved as a placeholder product with its barcode. */
  | { kind: 'offline' }
  /** Online but the lookup failed (rate limit, server error): same as offline. */
  | { kind: 'unavailable' }
  /** Not found anywhere: saved as «Article sans nom» unless named. */
  | { kind: 'unknown'; draft: CatalogLookupDraft }
  /** In-store variable-measure code: never looked up; needs a product to be chosen or created. */
  | { kind: 'store-code' }
  /** Named by the user in the unknown-product sheet. */
  | { kind: 'named'; input: NewProductInput };

export interface TrayRow {
  id: string;
  /** Merge key: the 14-digit GTIN, `store:<digits>` for in-store codes, `product:<id>` for picked products. */
  key: string;
  /** Digits as read (shown while searching and on code rows). */
  digits: string;
  /** Barcode stored on a product created from this row; null for in-store codes and picked products. */
  gtin: Gtin | null;
  quantity: number;
  status: RowStatus;
  /** Withdraw: the cellier chosen with «Retirer de {other}» (otherwise the tray's cellier). */
  sourcePantryId: PantryId | null;
}

export interface TrayState {
  /** Newest (or last incremented) first. */
  rows: readonly TrayRow[];
  nextId: number;
  /** Last removed row, for «Annuler». */
  removed: { row: TrayRow; index: number } | null;
  /** Codes recognised in this session (each insert or increment). */
  recognitions: number;
}

export const initialTrayState: TrayState = { rows: [], nextId: 1, removed: null, recognitions: 0 };

export type TrayAction =
  /** A valid, de-duplicated code from the camera or the manual entry. `known`: synchronous local hit. */
  | { type: 'detected'; code: ScannedCode; known?: { productId: ProductId; deleted: boolean } | null }
  /** A household product picked by name (manual entry, in-store code). */
  | { type: 'picked'; productId: ProductId; rowId?: string | undefined }
  | { type: 'resolved'; rowId: string; outcome: ScanOutcome }
  /** Re-run the lookup of an offline / unavailable row (connection back). */
  | { type: 'retry'; rowId: string }
  | { type: 'setQuantity'; rowId: string; quantity: number }
  | { type: 'remove'; rowId: string }
  | { type: 'undoRemove' }
  | { type: 'name'; rowId: string; input: NewProductInput }
  | { type: 'setSource'; rowId: string; pantryId: PantryId }
  | { type: 'restore'; rows: readonly TrayRow[] }
  | { type: 'clear' };

export function rowKey(code: ScannedCode): string {
  return code.kind === 'product' ? code.gtin14 : `store:${code.digits}`;
}

const clampQuantity = (q: number) => Math.min(MAX_QUANTITY, Math.max(1, Math.trunc(q)));

function moveToTop(rows: readonly TrayRow[], row: TrayRow): TrayRow[] {
  return [row, ...rows.filter((r) => r.id !== row.id)];
}

function patchRow(state: TrayState, rowId: string, patch: (row: TrayRow) => TrayRow | null): TrayState {
  const index = state.rows.findIndex((r) => r.id === rowId);
  if (index < 0) return state;
  const row = state.rows[index] as TrayRow;
  const next = patch(row);
  if (next === row) return state;
  const rows = [...state.rows];
  if (next === null) rows.splice(index, 1);
  else rows[index] = next;
  return { ...state, rows };
}

/** The row already holding this household product, if any. */
function rowOfProduct(rows: readonly TrayRow[], productId: ProductId, exceptId?: string): TrayRow | undefined {
  return rows.find((r) => r.id !== exceptId && r.status.kind === 'household' && r.status.productId === productId);
}

function statusFromOutcome(outcome: ScanOutcome): RowStatus | null {
  switch (outcome.kind) {
    case 'found_household':
      return { kind: 'household', productId: outcome.productId, deleted: outcome.restoredFromTombstone };
    case 'found_catalogue':
      return { kind: 'catalogue', product: outcome.product, origin: 'catalogue' };
    case 'found_online':
      return { kind: 'catalogue', product: outcome.product, origin: 'online' };
    case 'not_found':
      return { kind: 'unknown', draft: outcome.draft };
    case 'offline':
      return { kind: 'offline' };
    case 'lookup_unavailable':
      return { kind: 'unavailable' };
    case 'variable_measure':
      return { kind: 'store-code' };
    default:
      // invalid_checksum / invalid_format: the row should never have existed.
      return null;
  }
}

export function trayReducer(state: TrayState, action: TrayAction): TrayState {
  switch (action.type) {
    case 'detected': {
      const key = rowKey(action.code);
      const known = action.known ?? null;
      const existing =
        state.rows.find((r) => r.key === key) ?? (known ? rowOfProduct(state.rows, known.productId) : undefined);
      if (existing) {
        const row = { ...existing, quantity: clampQuantity(existing.quantity + 1) };
        return { ...state, rows: moveToTop(state.rows, row), recognitions: state.recognitions + 1 };
      }
      const code = action.code;
      const status: RowStatus =
        code.kind === 'variable-measure'
          ? { kind: 'store-code' }
          : known
            ? { kind: 'household', productId: known.productId, deleted: known.deleted }
            : { kind: 'searching' };
      const row: TrayRow = {
        id: `row-${state.nextId}`,
        key,
        digits: code.digits,
        gtin: code.kind === 'product' ? (code.gtin14 as Gtin) : null,
        quantity: 1,
        status,
        sourcePantryId: null,
      };
      return { ...state, rows: [row, ...state.rows], nextId: state.nextId + 1, recognitions: state.recognitions + 1 };
    }

    case 'picked': {
      // Choosing a product for an in-store code row turns that row into the product.
      if (action.rowId !== undefined) {
        const target = state.rows.find((r) => r.id === action.rowId);
        if (!target) return state;
        const other = rowOfProduct(state.rows, action.productId, target.id);
        if (other) {
          const merged = { ...other, quantity: clampQuantity(other.quantity + target.quantity) };
          return {
            ...state,
            rows: moveToTop(
              state.rows.filter((r) => r.id !== target.id),
              merged,
            ),
          };
        }
        return patchRow(state, target.id, (r) => ({
          ...r,
          status: { kind: 'household', productId: action.productId, deleted: false },
        }));
      }
      const existing = rowOfProduct(state.rows, action.productId);
      if (existing) {
        const row = { ...existing, quantity: clampQuantity(existing.quantity + 1) };
        return { ...state, rows: moveToTop(state.rows, row), recognitions: state.recognitions + 1 };
      }
      const row: TrayRow = {
        id: `row-${state.nextId}`,
        key: `product:${action.productId}`,
        digits: '',
        gtin: null,
        quantity: 1,
        status: { kind: 'household', productId: action.productId, deleted: false },
        sourcePantryId: null,
      };
      return { ...state, rows: [row, ...state.rows], nextId: state.nextId + 1, recognitions: state.recognitions + 1 };
    }

    case 'resolved': {
      const target = state.rows.find((r) => r.id === action.rowId);
      // A stale answer (row removed, or already resolved) changes nothing.
      if (target?.status.kind !== 'searching') return state;
      const status = statusFromOutcome(action.outcome);
      if (status === null) return patchRow(state, target.id, () => null);
      if (status.kind === 'household') {
        const other = rowOfProduct(state.rows, status.productId, target.id);
        if (other) {
          const merged = { ...other, quantity: clampQuantity(other.quantity + target.quantity) };
          return {
            ...state,
            rows: state.rows.filter((r) => r.id !== target.id).map((r) => (r.id === other.id ? merged : r)),
          };
        }
      }
      return patchRow(state, target.id, (r) => ({
        ...r,
        status,
        ...(status.kind === 'store-code' ? { gtin: null } : {}),
      }));
    }

    case 'retry':
      return patchRow(state, action.rowId, (r) =>
        r.status.kind === 'offline' || r.status.kind === 'unavailable' ? { ...r, status: { kind: 'searching' } } : r,
      );

    case 'setQuantity': {
      if (!Number.isFinite(action.quantity)) return state;
      if (action.quantity < 1) return trayReducer(state, { type: 'remove', rowId: action.rowId });
      return patchRow(state, action.rowId, (r) => {
        const quantity = clampQuantity(action.quantity);
        return quantity === r.quantity ? r : { ...r, quantity };
      });
    }

    case 'remove': {
      const index = state.rows.findIndex((r) => r.id === action.rowId);
      if (index < 0) return state;
      const row = state.rows[index] as TrayRow;
      return { ...state, rows: state.rows.filter((r) => r.id !== row.id), removed: { row, index } };
    }

    case 'undoRemove': {
      const removed = state.removed;
      if (!removed) return state;
      const same =
        state.rows.find((r) => r.key === removed.row.key) ??
        (removed.row.status.kind === 'household' ? rowOfProduct(state.rows, removed.row.status.productId) : undefined);
      if (same) {
        const merged = { ...same, quantity: clampQuantity(same.quantity + removed.row.quantity) };
        return { ...state, rows: state.rows.map((r) => (r.id === same.id ? merged : r)), removed: null };
      }
      const rows = [...state.rows];
      rows.splice(Math.min(removed.index, rows.length), 0, removed.row);
      return { ...state, rows, removed: null };
    }

    case 'name':
      return patchRow(state, action.rowId, (r) =>
        r.status.kind === 'searching' || r.status.kind === 'household'
          ? r
          : { ...r, status: { kind: 'named', input: action.input } },
      );

    case 'setSource':
      return patchRow(state, action.rowId, (r) => ({ ...r, sourcePantryId: action.pantryId }));

    case 'restore': {
      const rows = action.rows.filter(isTrayRow);
      const maxId = rows.reduce((n, r) => Math.max(n, Number(r.id.replace(/^row-/, '')) || 0), 0);
      return { ...initialTrayState, rows, nextId: Math.max(state.nextId, maxId + 1) };
    }

    case 'clear':
      return { ...initialTrayState, nextId: state.nextId };
  }
}

/** Shape check for rows read back from storage (drafts written by an older build are dropped). */
export function isTrayRow(value: unknown): value is TrayRow {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Partial<TrayRow>;
  return (
    typeof r.id === 'string' &&
    typeof r.key === 'string' &&
    typeof r.digits === 'string' &&
    typeof r.quantity === 'number' &&
    Number.isInteger(r.quantity) &&
    r.quantity >= 1 &&
    typeof r.status === 'object' &&
    r.status !== null &&
    typeof (r.status as { kind?: unknown }).kind === 'string'
  );
}

// ---------------------------------------------------------------------------------------------
// Evaluation for the current mode (03 §4.4.3, §4.4.5, §4.4.6)
// ---------------------------------------------------------------------------------------------

export interface PantryQuantity {
  pantryId: PantryId;
  quantity: number;
}

export interface EvalContext {
  mode: ScanMode;
  /** The tray's cellier (null before the first pull). */
  pantryId: PantryId | null;
  /** Live quantity of a product in a pantry. */
  stockOf: (productId: ProductId, pantryId: PantryId) => number;
  /** Live pantries holding the product (quantity > 0). */
  holdings: (productId: ProductId) => readonly PantryQuantity[];
}

export type RowView =
  | { kind: 'pending' }
  | { kind: 'store-code' }
  /** Add mode: committable. `inStock` is the household product's quantity in the tray's cellier. */
  | { kind: 'add'; existing: boolean; inStock: number }
  /** Withdraw mode, committable: up to `max` units from `pantryId`. */
  | { kind: 'withdraw'; productId: ProductId; pantryId: PantryId; max: number }
  /** Withdraw mode: none in the chosen cellier, `quantity` in `other`. */
  | { kind: 'elsewhere'; productId: ProductId; other: PantryId; quantity: number }
  /** Withdraw mode: not in stock anywhere, or unknown to the household. Not committable. */
  | { kind: 'absent' };

export function evaluateRow(row: TrayRow, ctx: EvalContext): RowView {
  const s = row.status;
  if (s.kind === 'searching') return { kind: 'pending' };
  if (s.kind === 'store-code') return { kind: 'store-code' };
  if (ctx.mode === 'add') {
    if (s.kind === 'household') {
      return {
        kind: 'add',
        existing: !s.deleted,
        inStock: ctx.pantryId && !s.deleted ? ctx.stockOf(s.productId, ctx.pantryId) : 0,
      };
    }
    return { kind: 'add', existing: false, inStock: 0 };
  }
  if (s.kind !== 'household' || s.deleted) return { kind: 'absent' };
  const source = row.sourcePantryId ?? ctx.pantryId;
  const here = source ? ctx.stockOf(s.productId, source) : 0;
  if (source && here > 0) return { kind: 'withdraw', productId: s.productId, pantryId: source, max: here };
  const others = ctx.holdings(s.productId).filter((h) => h.pantryId !== source && h.quantity > 0);
  const best = others.reduce<PantryQuantity | null>((a, h) => (a === null || h.quantity > a.quantity ? h : a), null);
  if (best) return { kind: 'elsewhere', productId: s.productId, other: best.pantryId, quantity: best.quantity };
  return { kind: 'absent' };
}

export function isCommittable(view: RowView, ctx: Pick<EvalContext, 'pantryId'>): boolean {
  if (view.kind === 'withdraw') return true;
  return view.kind === 'add' && ctx.pantryId !== null;
}

/** Units the row will move: its quantity, clamped to what the source cellier holds in withdraw mode. */
export function effectiveQuantity(row: TrayRow, view: RowView): number {
  return view.kind === 'withdraw' ? Math.min(row.quantity, view.max) : row.quantity;
}

/** Units of the committable rows (tray header count). */
export function committableUnits(rows: readonly TrayRow[], ctx: EvalContext): number {
  let n = 0;
  for (const row of rows) {
    const view = evaluateRow(row, ctx);
    if (isCommittable(view, ctx)) n += effectiveQuantity(row, view);
  }
  return n;
}

// ---------------------------------------------------------------------------------------------
// Commit plan (03 §4.4.7)
// ---------------------------------------------------------------------------------------------

export interface CommitContext extends EvalContext {
  categories: readonly Pick<Category, 'id' | 'templateKey' | 'deletedAt'>[];
  newProductId: () => ProductId;
  now: number;
  /** «Article sans nom». */
  unnamedLabel: string;
}

export type StockStep =
  | { name: 'stock.add'; args: MutationArgs['stock.add'] }
  | { name: 'stock.remove'; args: MutationArgs['stock.remove'] };

export interface CommitStep {
  rowId: string;
  /** Product to create first; the stock step's productId is replaced by the id `mutate` returns. */
  create: MutationArgs['product.create'] | null;
  /** Tombstoned household product to restore first. */
  restore: ProductId | null;
  stock: StockStep;
}

export interface CommitPlan {
  steps: CommitStep[];
  /** Rows that are not committable (searching, in-store code not chosen, absent, elsewhere). */
  skipped: number;
}

function createArgs(row: TrayRow, ctx: CommitContext): MutationArgs['product.create'] | null {
  const s = row.status;
  const productId = ctx.newProductId();
  const gtin = row.gtin;
  switch (s.kind) {
    case 'catalogue':
      return catalogueToProductCreate(s.product, { productId, categories: ctx.categories, now: ctx.now }).args;
    case 'named': {
      const { input } = s;
      return {
        productId,
        name: input.name,
        gtin,
        categoryId: input.categoryId,
        // A category picked in the sheet is the member's choice; the 'autre' default is not.
        categorySource:
          input.categoryId !== null && ctx.categories.find((c) => c.id === input.categoryId)?.templateKey !== 'autre'
            ? 'user'
            : null,
        netQuantity: input.netQuantity,
        netUnit: input.netUnit,
        priceCents: input.priceCents,
        priceSource: input.priceCents !== null ? 'user' : null,
      };
    }
    case 'unknown': {
      const d = s.draft;
      return {
        productId,
        name: ctx.unnamedLabel,
        gtin,
        brand: d?.brand ?? null,
        categoryId: resolveHouseholdCategory(ctx.categories, d?.categoryKey ?? null),
        netQuantity: d?.netQuantity ?? null,
        netUnit: d?.netUnit ?? null,
        packCount: d?.packCount ?? null,
        imageUrl: d?.imageUrl ?? null,
      };
    }
    case 'offline':
    case 'unavailable':
      return {
        productId,
        name: ctx.unnamedLabel,
        gtin,
        categoryId: resolveHouseholdCategory(ctx.categories, null),
      };
    default:
      return null;
  }
}

/** One step per committable row, in tray order; product creations happen inside each step, first. */
export function planCommit(rows: readonly TrayRow[], ctx: CommitContext): CommitPlan {
  const steps: CommitStep[] = [];
  let skipped = 0;
  // Oldest first, so the ledger reads in scan order.
  for (const row of [...rows].reverse()) {
    const view = evaluateRow(row, ctx);
    if (!isCommittable(view, ctx)) {
      skipped += 1;
      continue;
    }
    const quantity = effectiveQuantity(row, view);
    if (view.kind === 'withdraw') {
      steps.push({
        rowId: row.id,
        create: null,
        restore: null,
        stock: {
          name: 'stock.remove',
          args: { pantryId: view.pantryId, productId: view.productId, quantity, reason: 'consume', source: 'scan' },
        },
      });
      continue;
    }
    const pantryId = ctx.pantryId as PantryId;
    const s = row.status;
    if (s.kind === 'household') {
      steps.push({
        rowId: row.id,
        create: null,
        restore: s.deleted ? s.productId : null,
        stock: { name: 'stock.add', args: { pantryId, productId: s.productId, quantity, source: 'scan' } },
      });
      continue;
    }
    const create = createArgs(row, ctx);
    if (!create) {
      skipped += 1;
      continue;
    }
    steps.push({
      rowId: row.id,
      create,
      restore: null,
      stock: { name: 'stock.add', args: { pantryId, productId: create.productId, quantity, source: 'scan' } },
    });
  }
  return { steps, skipped };
}
