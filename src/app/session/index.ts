/**
 * Session API for screens and features:
 *
 *   const session = useSession();            // { status: 'loading'|'signedOut'|'signedIn'|'expired', user }
 *   const household = useActiveHousehold();  // { id, name, isOwner } (id null before onboarding)
 *   const pantry = useActivePantry();        // { selection, pantry, pantries, isAll, select(id|'all') }
 *   await signOut();                         // after the account page's confirmation
 */
import { useSyncExternalStore } from 'react';
import type { HouseholdId, Pantry, PantryId } from '@/domain/types';
import { useHousehold, useIsOwner } from '@/entities/member';
import { usePantries } from '@/entities/pantry';
import { useSyncSummary } from '@/entities/sync';
import { type AuthState, type SessionUser, useOnline } from '@/features/auth';
import { type AppSessionState, getAppSession, subscribeAppSession } from './appSession';
import { type PantrySelection, resolvePantrySelection, usePantryPreference, writePantryPreference } from './pantry';

export {
  type AppSessionState,
  bootstrapSession,
  enterHousehold,
  getAppSession,
  getHouseholds,
  guardState,
  leaveRemovedHousehold,
  refreshMembership,
  settled,
  signOut,
  subscribeAppSession,
} from './appSession';
export { type PantrySelection, resolvePantrySelection } from './pantry';
export { attentionActions, quarantine, syncNow } from './sync';

export function useAppSession(): AppSessionState {
  return useSyncExternalStore(subscribeAppSession, getAppSession, getAppSession);
}

export function useSession(): { status: AuthState['status']; user: SessionUser | null } {
  const { auth } = useAppSession();
  return { status: auth.status, user: auth.status === 'signedIn' || auth.status === 'expired' ? auth.user : null };
}

export interface ActiveHousehold {
  id: HouseholdId | null;
  /** From the local store; null until the first pull. */
  name: string | null;
  isOwner: boolean;
}

export function useActiveHousehold(): ActiveHousehold {
  const { household } = useAppSession();
  const row = useHousehold();
  const isOwner = useIsOwner();
  return { id: household.id, name: row?.name ?? null, isOwner };
}

export interface ActivePantry {
  /** Current cellier id, `'all'` for «Tous les celliers», null before the first pull. */
  selection: PantrySelection | null;
  pantry: Pantry | null;
  pantries: readonly Pantry[];
  isAll: boolean;
  select(selection: PantryId | 'all'): void;
}

export function useActivePantry(): ActivePantry {
  const { household } = useAppSession();
  const pantries = usePantries();
  const preference = usePantryPreference(household.id);
  const { selection, pantry } = resolvePantrySelection(preference, pantries);
  return {
    selection,
    pantry,
    pantries,
    isAll: selection === 'all',
    select: (next) => {
      if (household.id) writePantryPreference(household.id, next);
    },
  };
}

/**
 * Design 03 §2.5.2: `loading` while the first pull of the household runs (lists show
 * `SkeletonRow`s), `offline` when it cannot start (tab roots show «Connexion nécessaire»).
 */
export function useFirstSyncState(): 'ready' | 'loading' | 'offline' {
  const { household } = useAppSession();
  const summary = useSyncSummary();
  const online = useOnline();
  if (!household.id || !summary.firstSync) return 'ready';
  return online && !summary.offline ? 'loading' : 'offline';
}
