/**
 * «Modification remplacée»: field overwrites whose replaced value was written by this device
 * (the device id ends `oldHlc`), newest first.
 */
import type { FieldOverwrite } from '@/domain/types';
import { hlcDeviceId, useStore, useSyncEngine } from '@/shared/sync';
import { createSelector, keyedSelector, type Selector } from '../lib/selector';

export const selectOverwrites: Selector<readonly FieldOverwrite[]> = createSelector(
  (s) => [s.rows.overwrite] as const,
  (rows) => [...rows.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
);

/** Overwrites to show on the device `deviceId`. */
export const selectOverwritesForDevice = keyedSelector((deviceId: string) =>
  createSelector(
    (s) => [selectOverwrites(s)] as const,
    (all) => all.filter((o) => hlcDeviceId(o.oldHlc) === deviceId),
  ),
);

/** Overwrites of one row (e.g. a product's fields), for the product detail. */
export const selectRowOverwrites = keyedSelector((rowId: string) =>
  createSelector(
    (s) => [selectOverwrites(s)] as const,
    (all) => all.filter((o) => o.rowId === rowId),
  ),
);

const none: readonly FieldOverwrite[] = [];
const selectNone: Selector<readonly FieldOverwrite[]> = () => none;

/** Overwrites of values this device wrote. */
export function useMyOverwrites(): readonly FieldOverwrite[] {
  const deviceId = useSyncEngine()?.deviceId ?? null;
  return useStore(deviceId ? selectOverwritesForDevice(deviceId) : selectNone);
}

export function useRowOverwrites(rowId: string): readonly FieldOverwrite[] {
  return useStore(selectRowOverwrites(rowId));
}
