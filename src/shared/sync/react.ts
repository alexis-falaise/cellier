/**
 * React bindings (contract `SyncReactBindings`). Screens read with `useStore(selector)` and write
 * with `useMutate()`. Selectors should be memoised on the snapshot maps they read (see
 * src/entities/**) so that `useStore` re-renders only when the selected value changes.
 */
import { useMemo, useSyncExternalStore } from 'react';
import type { SyncStatus } from '@/domain/types';
import type { StoreSnapshot, SyncEngine, SyncReactBindings } from './contract';
import type { CellierSyncEngine } from './engine';
import { getSyncEngine, getSyncStore, mutate, requireSyncEngine, subscribeSyncEngine } from './session';
import type { CellierSnapshot } from './store';

/** useSyncExternalStore over the snapshot; returns the previous value while `isEqual` holds. */
export function useStore<T>(selector: (s: CellierSnapshot) => T, isEqual: (a: T, b: T) => boolean = Object.is): T {
  const store = getSyncStore();
  const getSelection = useMemo(() => {
    let has = false;
    let lastSnapshot: StoreSnapshot | null = null;
    let lastValue: T;
    return (): T => {
      const snapshot = store.getSnapshot();
      if (has && snapshot === lastSnapshot) return lastValue;
      const next = selector(snapshot);
      lastSnapshot = snapshot;
      if (has && isEqual(lastValue, next)) return lastValue;
      has = true;
      lastValue = next;
      return next;
    };
  }, [store, selector, isEqual]);
  return useSyncExternalStore(store.subscribe, getSelection, getSelection);
}

/** Stable `mutate` of the current session (synchronous; throws MutationValidationError). */
export function useMutate(): SyncEngine['mutate'] {
  return mutate;
}

const selectStatus = (s: CellierSnapshot) => s.status;

export function useSyncStatus(): SyncStatus {
  return useStore(selectStatus);
}

/** The running engine, or null before `startSync` / after sign-out. */
export function useSyncEngine(): CellierSyncEngine | null {
  return useSyncExternalStore(subscribeSyncEngine, getSyncEngine, getSyncEngine);
}

/** Engine actions for the sync sheet, Activité and À vérifier (bound to the current session). */
export const syncActions = {
  syncNow: () => requireSyncEngine().sync('manual'),
  undo: (id: Parameters<CellierSyncEngine['undo']>[0]) => requireSyncEngine().undo(id),
  discardAttention: (id: Parameters<CellierSyncEngine['discardAttention']>[0]) =>
    requireSyncEngine().discardAttention(id),
  retryAttention: (id: Parameters<CellierSyncEngine['retryAttention']>[0]) => requireSyncEngine().retryAttention(id),
  markActivityRead: (ids: string[]) => requireSyncEngine().markActivityRead(ids),
  quarantineCsv: () => requireSyncEngine().quarantineCsv(),
  discardQuarantined: () => requireSyncEngine().discardQuarantined(),
  resolveId: (id: string) => getSyncEngine()?.resolveId(id) ?? id,
};

export const syncReactBindings: SyncReactBindings = { useStore, useMutate, useSyncStatus };
