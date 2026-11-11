/**
 * Wires the pure tray reducer to the app: synchronous local hits, the catalogue lookup chain (one aborted
 * request per removed row), the connection-back retry, the draft in storage, and the commit through `mutate`.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Gtin, MutationId, PantryId, ProductId } from '@/domain/types';
import { stockKey } from '@/domain/types';
import { useCategories } from '@/entities/category';
import { usePantries } from '@/entities/pantry';
import { t } from '@/shared/i18n';
import type { ScannedCode } from '@/shared/lib/gtin';
import { getSyncStore, mutate, syncActions, useStore } from '@/shared/sync';
import { draftStore, lookupHousehold } from './local';
import { catalogueLookup } from './lookup';
import {
  type CommitContext,
  committableUnits,
  type EvalContext,
  initialTrayState,
  type NewProductInput,
  type PantryQuantity,
  planCommit,
  type ScanMode,
  type TrayState,
  trayReducer,
} from './tray';

export interface CommitResult {
  /** Units written. */
  units: number;
  /** Rows not written (not committable, or refused by validation). */
  skipped: number;
  /** Stock mutation ids, for «Annuler». */
  movementIds: MutationId[];
  pantryIds: PantryId[];
}

export interface ScanFlowOptions {
  mode: ScanMode;
  /** The tray's cellier. */
  pantryId: PantryId | null;
  householdId: string | null;
}

export function useScanFlow({ mode, pantryId, householdId }: ScanFlowOptions) {
  const [state, dispatch] = useReducer(trayReducer, initialTrayState);
  const stateRef = useRef<TrayState>(state);
  useLayoutEffect(() => {
    stateRef.current = state;
  });

  // --- Draft: restore once, then write on every change ------------------------------------------
  const [restoredCount, setRestoredCount] = useState(0);
  const restoredFor = useRef<string | null>(null);
  useEffect(() => {
    if (!householdId || restoredFor.current === householdId) return;
    restoredFor.current = householdId;
    const draft = draftStore.read(householdId);
    if (!draft || stateRef.current.rows.length > 0) return;
    dispatch({ type: 'restore', rows: draft.rows });
    setRestoredCount(draft.rows.reduce((n, r) => n + r.quantity, 0));
  }, [householdId]);

  const persistMode = useRef(mode);
  useLayoutEffect(() => {
    persistMode.current = mode;
  });
  useEffect(() => {
    if (!householdId || restoredFor.current !== householdId) return;
    draftStore.write(householdId, state.rows, persistMode.current);
  }, [householdId, state.rows]);

  // --- Lookups: one per searching row, aborted when the row goes away ---------------------------
  const controllers = useRef(new Map<string, AbortController>());
  useEffect(() => {
    const searching = new Set(state.rows.filter((r) => r.status.kind === 'searching').map((r) => r.id));
    for (const [id, controller] of controllers.current) {
      if (searching.has(id)) continue;
      controller.abort(new DOMException('Row gone', 'AbortError'));
      controllers.current.delete(id);
    }
    for (const row of state.rows) {
      if (row.status.kind !== 'searching' || controllers.current.has(row.id) || !row.gtin) continue;
      const controller = new AbortController();
      controllers.current.set(row.id, controller);
      const rowId = row.id;
      // The 14-digit key minus its padding zero is a valid EAN-13 for every product format.
      catalogueLookup()
        .lookup(row.gtin.slice(1), { signal: controller.signal })
        .then(
          (outcome) => {
            if (controller.signal.aborted) return;
            dispatch({ type: 'resolved', rowId, outcome });
          },
          () => {
            if (controller.signal.aborted) return;
            dispatch({
              type: 'resolved',
              rowId,
              outcome: { kind: 'lookup_unavailable', gtin: row.gtin as Gtin, retryAfter: null },
            });
          },
        )
        .finally(() => {
          if (controllers.current.get(rowId) === controller) controllers.current.delete(rowId);
        });
    }
  }, [state.rows]);

  useEffect(() => {
    const map = controllers.current;
    return () => {
      for (const c of map.values()) c.abort(new DOMException('Scanner closed', 'AbortError'));
      map.clear();
    };
  }, []);

  // Connection back: offline rows are looked up again so they get a name before the commit.
  useEffect(() => {
    const onOnline = () => {
      for (const row of stateRef.current.rows) {
        if (row.status.kind === 'offline' || row.status.kind === 'unavailable')
          dispatch({ type: 'retry', rowId: row.id });
      }
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);

  // --- Store reads for the current mode ----------------------------------------------------------
  const stock = useStore((s) => s.rows.stock);
  const aliases = useStore((s) => s.aliases);
  const pantries = usePantries();
  const categories = useCategories();

  const ctx: EvalContext = useMemo(() => {
    const resolve = (id: string) => aliases.get(id) ?? id;
    const stockOf = (productId: ProductId, pantry: PantryId) =>
      stock.get(stockKey(resolve(pantry) as PantryId, resolve(productId) as ProductId))?.quantity ?? 0;
    return {
      mode,
      pantryId,
      stockOf,
      holdings: (productId: ProductId): PantryQuantity[] =>
        pantries.map((p) => ({ pantryId: p.id, quantity: stockOf(productId, p.id) })).filter((h) => h.quantity > 0),
    };
  }, [mode, pantryId, stock, aliases, pantries]);

  const units = useMemo(() => committableUnits(state.rows, ctx), [state.rows, ctx]);

  // --- Actions -----------------------------------------------------------------------------------
  /** Call from the detection handler; dispatches synchronously with any local hit. */
  const detect = useCallback((code: ScannedCode): void => {
    const known = code.kind === 'product' ? lookupHousehold(getSyncStore().getSnapshot(), code.gtin14 as Gtin) : null;
    dispatch({ type: 'detected', code, known });
  }, []);

  const pick = useCallback(
    (productId: ProductId, rowId?: string) => dispatch({ type: 'picked', productId, rowId }),
    [],
  );
  const setQuantity = useCallback(
    (rowId: string, quantity: number) => dispatch({ type: 'setQuantity', rowId, quantity }),
    [],
  );
  const remove = useCallback((rowId: string) => dispatch({ type: 'remove', rowId }), []);
  const undoRemove = useCallback(() => dispatch({ type: 'undoRemove' }), []);
  const name = useCallback((rowId: string, input: NewProductInput) => dispatch({ type: 'name', rowId, input }), []);
  const setSource = useCallback(
    (rowId: string, pantry: PantryId) => dispatch({ type: 'setSource', rowId, pantryId: pantry }),
    [],
  );

  const clearRestored = useCallback(() => setRestoredCount(0), []);

  const discard = useCallback(() => {
    dispatch({ type: 'clear' });
    if (householdId) draftStore.clear(householdId);
  }, [householdId]);

  /** Writes the tray: product creations first, then one stock movement per row (source `scan`). */
  const commit = useCallback((): CommitResult => {
    const commitCtx: CommitContext = {
      ...ctx,
      categories,
      newProductId: () => crypto.randomUUID() as ProductId,
      now: Date.now(),
      unnamedLabel: t('scanner.unknown.unnamed'),
    };
    const plan = planCommit(stateRef.current.rows, commitCtx);
    const movementIds: MutationId[] = [];
    const pantryIds = new Set<PantryId>();
    let unitsWritten = 0;
    let failed = 0;
    for (const step of plan.steps) {
      try {
        let productId = step.stock.args.productId;
        if (step.restore) mutate('product.restore', { productId: step.restore });
        if (step.create) productId = mutate('product.create', step.create) as unknown as ProductId;
        const id =
          step.stock.name === 'stock.add'
            ? mutate('stock.add', { ...step.stock.args, productId })
            : mutate('stock.remove', { ...step.stock.args, productId });
        movementIds.push(id);
        pantryIds.add(step.stock.args.pantryId);
        unitsWritten += step.stock.args.quantity;
      } catch (error) {
        failed += 1;
        console.warn('[scan] row not saved', error);
      }
    }
    dispatch({ type: 'clear' });
    if (householdId) draftStore.clear(householdId);
    return { units: unitsWritten, skipped: plan.skipped + failed, movementIds, pantryIds: [...pantryIds] };
  }, [ctx, categories, householdId]);

  return {
    state,
    ctx,
    units,
    categories,
    pantries,
    restoredCount,
    clearRestored,
    detect,
    pick,
    setQuantity,
    remove,
    undoRemove,
    name,
    setSource,
    discard,
    commit,
  };
}

export type ScanFlow = ReturnType<typeof useScanFlow>;

/** Compensating mutations for a committed scan session («Annuler» on the toast). */
export async function undoCommit(movementIds: readonly MutationId[]): Promise<void> {
  for (const id of movementIds) {
    try {
      await syncActions.undo(id);
    } catch (error) {
      console.warn('[scan] undo failed', error);
    }
  }
}
