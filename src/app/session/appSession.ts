/**
 * Composition root of the signed-in session: creates the auth store on the Supabase client, resolves
 * the household (cached on the device, else asked to the server), starts sync for it, reconciles
 * push, and publishes one state for the route guards and the screens.
 */
import type { HouseholdId, UserId } from '@/domain/types';
import {
  type AuthClientLike,
  type AuthState,
  type AuthStore,
  clearPendingInvite,
  createAuthStore,
  createHouseholdApi,
  disableGoogleAutoSelect,
  type HouseholdApi,
  type HouseholdClient,
  isOnline,
  type KeyValueStorage,
  readPendingInvite,
  registerAuthServices,
} from '@/features/auth';
import {
  browserPushEnvironment,
  disablePush,
  localStoragePushStore,
  type PushClient,
  type PushDeps,
  reconcilePush,
} from '@/features/notifications';
import type { GuardState, HouseholdPhase } from '../guards';
import {
  changeSyncHousehold,
  clearSyncData,
  readCachedHouseholdId,
  readNotice,
  startHouseholdSync,
  subscribeNotice,
  syncNow,
} from './sync';

export interface AppSessionState {
  auth: AuthState;
  household: { phase: HouseholdPhase; id: HouseholdId | null };
  /** Membership revoked or household deleted: `/removed`. */
  removed: boolean;
}

const LOCAL_PREFIXES = ['cellier:pantry:', 'cellier:last-user', 'cellier:gis-nonce'];

function localStore(): KeyValueStorage {
  const memory = new Map<string, string>();
  const ls = (): Storage | null => {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
      return null;
    }
  };
  return {
    getItem: (k) => ls()?.getItem(k) ?? memory.get(k) ?? null,
    setItem: (k, v) => {
      memory.set(k, v);
      try {
        ls()?.setItem(k, v);
      } catch {
        // memory copy only
      }
    },
    removeItem: (k) => {
      memory.delete(k);
      try {
        ls()?.removeItem(k);
      } catch {
        // ignore
      }
    },
  };
}

function clearLocalPreferences() {
  try {
    for (const key of Object.keys(localStorage)) {
      if (LOCAL_PREFIXES.some((p) => key.startsWith(p))) localStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
  clearPendingInvite();
}

let state: AppSessionState = {
  auth: { status: 'loading' },
  household: { phase: 'unknown', id: null },
  removed: false,
};
const listeners = new Set<() => void>();
let auth: AuthStore | null = null;
let households: HouseholdApi | null = null;
let pushDeps: PushDeps | null = null;
let booting: Promise<void> | null = null;
/** Serialises reactions to auth changes; `settled()` waits for it. */
let transition: Promise<void> = Promise.resolve();
let resolvedFor: UserId | null = null;
let pushReconciledFor: UserId | null = null;
let lastReconcileAt = 0;

function set(patch: Partial<AppSessionState>) {
  state = { ...state, ...patch };
  for (const l of [...listeners]) l();
}

export function getAppSession(): AppSessionState {
  return state;
}

export function subscribeAppSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function guardState(): GuardState {
  const a = state.auth.status;
  return {
    auth: a === 'signedIn' ? 'signedIn' : a === 'expired' ? 'expired' : 'signedOut',
    household: state.household.phase,
    removed: state.removed,
    pendingInvite: readPendingInvite(),
  };
}

function maybeReconcilePush(userId: UserId, force = false) {
  if (!pushDeps || !isOnline()) return;
  const stale = Date.now() - lastReconcileAt > 12 * 3600_000;
  if (!force && pushReconciledFor === userId && !stale) return;
  pushReconciledFor = userId;
  lastReconcileAt = Date.now();
  void reconcilePush(pushDeps, userId).catch((error: unknown) => console.warn('[push] reconcile failed', error));
}

async function resolveHousehold(next: AuthState): Promise<void> {
  if (next.status === 'loading') return;
  if (next.status === 'signedOut') {
    resolvedFor = null;
    set({ household: { phase: 'none', id: null }, removed: false });
    return;
  }
  const user = next.user;
  if (next.status === 'signedIn') {
    void syncNow();
    maybeReconcilePush(user.id);
  }
  if (resolvedFor === user.id && state.household.phase !== 'unknown') return;

  const cached = await readCachedHouseholdId();
  if (cached) {
    resolvedFor = user.id;
    set({ household: { phase: 'member', id: cached }, removed: readNotice() !== null });
    void startHouseholdSync(user.id, cached);
    return;
  }
  if (next.status === 'expired' || !households) {
    set({ household: { phase: 'none', id: null } });
    return;
  }
  const membership = await households.fetchMembership(user.id);
  if (!membership.ok) {
    // Offline on a new device: onboarding explains; `refreshMembership` retries when online.
    set({ household: { phase: 'none', id: null } });
    return;
  }
  resolvedFor = user.id;
  if (membership.householdId) {
    set({ household: { phase: 'member', id: membership.householdId }, removed: false });
    await startHouseholdSync(user.id, membership.householdId);
  } else {
    set({ household: { phase: 'none', id: null }, removed: false });
    void startHouseholdSync(user.id, null);
  }
}

function onAuthChange() {
  const next = auth?.getState() ?? { status: 'signedOut' as const };
  set({ auth: next });
  transition = transition
    .then(() => resolveHousehold(next))
    .catch((error: unknown) => {
      console.error('[session] household resolution failed', error);
    });
}

/** Loads the Supabase client lazily (it throws without env vars, as in tests) and reads the stored session. */
export function bootstrapSession(): Promise<void> {
  booting ??= (async () => {
    try {
      const { supabase } = await import('@/shared/api/supabase');
      auth = createAuthStore({
        client: supabase.auth as unknown as AuthClientLike,
        storage: localStore(),
        isOnline,
      });
      households = createHouseholdApi(supabase as unknown as HouseholdClient, isOnline);
      pushDeps = {
        env: browserPushEnvironment(),
        client: supabase as unknown as PushClient,
        store: localStoragePushStore(),
        vapidPublicKey: import.meta.env.VITE_VAPID_PUBLIC_KEY,
      };
      registerAuthServices({ auth, household: households });
      await auth.init();
      auth.subscribe(onAuthChange);
    } catch (error) {
      console.error('[session] auth unavailable', error);
    }
    onAuthChange();
    subscribeNotice((notice) => set({ removed: notice !== null }));
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => void refreshMembership());
      document.addEventListener('visibilitychange', () => {
        const s = state.auth;
        if (document.visibilityState === 'visible' && s.status === 'signedIn') maybeReconcilePush(s.user.id);
      });
    }
    await transition;
  })();
  return booting;
}

/** Resolves when no session transition (stored session read, membership lookup) is running. */
export async function settled(): Promise<void> {
  await bootstrapSession();
  let current: Promise<void>;
  do {
    current = transition;
    await current;
  } while (current !== transition);
}

/** Retries the membership lookup (online again, onboarding screen mounted). */
export function refreshMembership(): Promise<void> {
  if (state.household.phase === 'member') return settled();
  resolvedFor = null;
  const next = state.auth;
  transition = transition.then(() => resolveHousehold(next)).catch(() => undefined);
  return transition;
}

/** A household was created or joined from this device. */
export async function enterHousehold(householdId: HouseholdId): Promise<void> {
  const a = state.auth;
  if (a.status !== 'signedIn') return;
  resolvedFor = a.user.id;
  clearPendingInvite();
  await startHouseholdSync(a.user.id, householdId);
  await changeSyncHousehold(householdId);
  set({ household: { phase: 'member', id: householdId }, removed: false });
}

/** `/removed`, once the quarantine is exported or discarded: forget the old household. */
export async function leaveRemovedHousehold(): Promise<void> {
  await changeSyncHousehold(null);
  set({ household: { phase: 'none', id: null }, removed: false });
}

/** Explicit sign-out (Réglages › Compte): push off, sync stopped and IndexedDB wiped, local prefs cleared. */
export async function signOut(): Promise<void> {
  if (!auth) return;
  await auth.signOut(async () => {
    if (pushDeps) await disablePush(pushDeps).catch(() => undefined);
    await clearSyncData();
    clearLocalPreferences();
    disableGoogleAutoSelect();
  });
  resolvedFor = null;
  pushReconciledFor = null;
}

export function getHouseholds(): HouseholdApi | null {
  return households;
}
