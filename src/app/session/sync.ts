/**
 * The app shell's only integration point with the sync engine (src/shared/sync/README.md).
 * Everything else in src/app and src/widgets goes through these functions; screens read data with
 * the hooks of src/entities/*.
 */
import type { HouseholdId, UserId } from '@/domain/types';
import {
  forgetHousehold,
  getSyncEngine,
  getSyncStore,
  type HouseholdNotice,
  readActiveHouseholdId,
  signOutSync,
  startSync,
  switchHousehold,
  syncActions,
} from '@/shared/sync';

/** Starts (or retargets) the engine for this user and household; resolves once the local store is hydrated. */
export async function startHouseholdSync(userId: UserId, householdId: HouseholdId | null): Promise<void> {
  try {
    await startSync({ userId, householdId });
  } catch (error) {
    console.error('[session] sync failed to start', error);
  }
}

/** Opens another household (create, join) or none (after leaving a removed household). */
export async function changeSyncHousehold(householdId: HouseholdId | null): Promise<void> {
  if (!getSyncEngine()) return;
  try {
    await switchHousehold(householdId);
  } catch (error) {
    console.error('[session] household switch failed', error);
  }
}

/** Deletes a household's local data (after leaving or deleting it, or losing access to it). */
export async function forgetLocalHousehold(householdId: HouseholdId): Promise<void> {
  try {
    await forgetHousehold(householdId);
  } catch (error) {
    console.error('[session] local household data could not be deleted', error);
  }
}

/** The household stored on this device, for routing at boot before any network. */
export async function readCachedHouseholdId(): Promise<HouseholdId | null> {
  try {
    return await readActiveHouseholdId();
  } catch {
    return null;
  }
}

/** Sign-out: stops the engine and wipes IndexedDB (rows, outbox, cursors). */
export async function clearSyncData(): Promise<void> {
  await signOutSync();
}

/** After a re-sign-in or a tap on «Synchroniser maintenant» / «Réessayer». */
export function syncNow(): Promise<void> {
  return getSyncEngine() ? syncActions.syncNow() : Promise.resolve();
}

/** Membership problems reported by the engine (removed from the household, household deleted). */
export function readNotice(): HouseholdNotice {
  return getSyncStore().getSnapshot().notice;
}

export function subscribeNotice(listener: (notice: HouseholdNotice) => void): () => void {
  let last = readNotice();
  return getSyncStore().subscribe(() => {
    const next = readNotice();
    if (next === last) return;
    last = next;
    listener(next);
  });
}

/** Quarantine of /removed (design 03 §4.16). */
export const quarantine = {
  csv: (): string => (getSyncEngine() ? syncActions.quarantineCsv() : ''),
  discard: (): Promise<void> => (getSyncEngine() ? syncActions.discardQuarantined() : Promise.resolve()),
};

/** «À vérifier» actions of the SyncSheet. */
export const attentionActions = {
  discard: syncActions.discardAttention,
  retry: syncActions.retryAttention,
};
