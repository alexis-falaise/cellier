/**
 * Auth session store (research/17 §5, design 03 §2.5.9). Wraps the Supabase auth client behind a
 * small injected interface, exposes the state through `subscribe` / `getState` for
 * `useSyncExternalStore`, and tells a definitive session loss («Session expirée», local data kept)
 * apart from an explicit sign-out (local data cleared).
 */
import type { UserId } from '@/domain/types';

// ---------------------------------------------------------------------------------------------
// Ports (subset of `supabase.auth`; pass `supabase.auth as unknown as AuthClientLike`)
// ---------------------------------------------------------------------------------------------

export interface AuthUserLike {
  id: string;
  email?: string | null | undefined;
  user_metadata?: Record<string, unknown> | null | undefined;
}

export interface AuthSessionLike {
  user: AuthUserLike;
}

export interface AuthErrorLike {
  name?: string | undefined;
  message: string;
  status?: number | undefined;
  code?: string | undefined;
}

interface SessionResult {
  data: { session: AuthSessionLike | null } | null;
  error: AuthErrorLike | null;
}

export interface AuthClientLike {
  getSession(): Promise<SessionResult>;
  onAuthStateChange(callback: (event: string, session: AuthSessionLike | null) => void): {
    data: { subscription: { unsubscribe(): void } };
  };
  signInWithIdToken(credentials: { provider: 'google'; token: string; nonce: string }): Promise<SessionResult>;
  signInWithOAuth(credentials: {
    provider: 'google';
    options: { redirectTo: string; queryParams?: Record<string, string> };
  }): Promise<{ error: AuthErrorLike | null }>;
  exchangeCodeForSession(authCode: string): Promise<SessionResult>;
  signOut(options: { scope: 'local' | 'global' | 'others' }): Promise<{ error: AuthErrorLike | null }>;
}

/** Synchronous key-value storage (localStorage in the app, a Map in tests). */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

// ---------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------

export interface SessionUser {
  id: UserId;
  email: string | null;
  /** Full name from Google. */
  name: string | null;
  firstName: string | null;
  avatarUrl: string | null;
}

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; user: SessionUser }
  /**
   * The refresh token was rejected (never a network error): local data stays readable and writable,
   * the outbox keeps queueing. `wrongAccountEmail` is set after a sign-in with another account.
   */
  | { status: 'expired'; user: SessionUser; wrongAccountEmail: string | null };

export type SignInResult = { ok: true; user: SessionUser } | { ok: false; reason: 'offline' | 'generic' };
export type ExchangeResult = { ok: true } | { ok: false; reason: 'wrongContext' | 'expired' | 'offline' | 'generic' };

export interface AuthStore {
  getState(): AuthState;
  subscribe(listener: () => void): () => void;
  /** Reads the stored session once; resolves when the state is no longer `loading`. */
  init(): Promise<AuthState>;
  signInWithIdToken(token: string, nonce: string): Promise<SignInResult>;
  /** PKCE fallback: leaves the page for Google, back to `redirectTo` (`/auth/callback`). */
  signInWithRedirect(redirectTo: string): Promise<{ ok: boolean }>;
  /** `/auth/callback`: `detectSessionInUrl` is false, so the page exchanges the code explicitly. */
  exchangeCode(code: string): Promise<ExchangeResult>;
  /** Explicit sign-out: runs `beforeSignOut` (push, sync, local data), then ends the local session. */
  signOut(beforeSignOut?: () => Promise<void>): Promise<void>;
  dispose(): void;
}

export const LAST_USER_KEY = 'cellier:last-user';

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function toSessionUser(user: AuthUserLike): SessionUser {
  const meta = user.user_metadata ?? {};
  const name = text(meta.full_name) ?? text(meta.name);
  const firstName = text(meta.given_name) ?? (name ? (name.split(/\s+/)[0] ?? null) : null);
  return {
    id: user.id as UserId,
    email: text(user.email) ?? text(meta.email),
    name,
    firstName,
    avatarUrl: text(meta.avatar_url) ?? text(meta.picture),
  };
}

/** auth-js marks network failures as retryable (`AuthRetryableFetchError`, status 0 or 5xx). */
export function isNetworkError(error: AuthErrorLike | null | undefined): boolean {
  if (!error) return false;
  if (error.name === 'AuthRetryableFetchError') return true;
  if (error.status === 0 || (error.status !== undefined && error.status >= 500)) return true;
  return /network|fetch|load failed/i.test(error.message);
}

function readLastUser(storage: KeyValueStorage): SessionUser | null {
  try {
    const raw = storage.getItem(LAST_USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SessionUser>;
    return typeof parsed.id === 'string'
      ? {
          id: parsed.id as UserId,
          email: parsed.email ?? null,
          name: parsed.name ?? null,
          firstName: parsed.firstName ?? null,
          avatarUrl: parsed.avatarUrl ?? null,
        }
      : null;
  } catch {
    return null;
  }
}

export interface AuthStoreDeps {
  client: AuthClientLike;
  storage: KeyValueStorage;
  isOnline?: () => boolean;
}

export function createAuthStore({ client, storage, isOnline = () => true }: AuthStoreDeps): AuthStore {
  let state: AuthState = { status: 'loading' };
  const listeners = new Set<() => void>();
  let explicitSignOut = false;
  /** A local sign-out we started ourselves (wrong account): its SIGNED_OUT event is not an expiry. */
  let ignoreNextSignOut = false;
  let initPromise: Promise<AuthState> | null = null;

  const set = (next: AuthState) => {
    state = next;
    for (const l of [...listeners]) l();
  };

  const remember = (user: SessionUser) => {
    try {
      storage.setItem(LAST_USER_KEY, JSON.stringify(user));
    } catch {
      // best effort
    }
  };

  const forget = () => {
    try {
      storage.removeItem(LAST_USER_KEY);
    } catch {
      // best effort
    }
  };

  /** A session arrived (sign-in, refresh, restore). */
  const onSession = (session: AuthSessionLike) => {
    const user = toSessionUser(session.user);
    if (state.status === 'expired' && state.user.id !== user.id) {
      // Another Google account while this device holds the previous user's data and outbox.
      const previous = state.user;
      ignoreNextSignOut = true;
      void client.signOut({ scope: 'local' }).catch(() => undefined);
      set({ status: 'expired', user: previous, wrongAccountEmail: previous.email ?? '' });
      return;
    }
    remember(user);
    if (state.status === 'signedIn' && JSON.stringify(state.user) === JSON.stringify(user)) return;
    set({ status: 'signedIn', user });
  };

  const onSignedOut = () => {
    if (ignoreNextSignOut) {
      ignoreNextSignOut = false;
      return;
    }
    if (explicitSignOut) return;
    const last = state.status === 'signedIn' || state.status === 'expired' ? state.user : readLastUser(storage);
    if (last) set({ status: 'expired', user: last, wrongAccountEmail: null });
    else set({ status: 'signedOut' });
  };

  const { data } = client.onAuthStateChange((event, session) => {
    if (state.status === 'loading' && event === 'INITIAL_SESSION') return; // init() decides
    if (event === 'SIGNED_OUT') {
      onSignedOut();
      return;
    }
    if (session) onSession(session);
  });

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    init() {
      initPromise ??= (async () => {
        const last = readLastUser(storage);
        let result: SessionResult;
        try {
          result = await client.getSession();
        } catch (error) {
          result = { data: null, error: { name: 'AuthRetryableFetchError', message: String(error) } };
        }
        if (state.status !== 'loading') return state; // an auth event settled it meanwhile
        const session = result.data?.session ?? null;
        if (session) {
          onSession(session);
        } else if (last && (isNetworkError(result.error) || !isOnline())) {
          // Offline boot: the stored session could not be refreshed yet. Keep working locally.
          set({ status: 'signedIn', user: last });
        } else if (last) {
          set({ status: 'expired', user: last, wrongAccountEmail: null });
        } else {
          set({ status: 'signedOut' });
        }
        return state;
      })();
      return initPromise;
    },

    async signInWithIdToken(token, nonce) {
      try {
        const { data: result, error } = await client.signInWithIdToken({ provider: 'google', token, nonce });
        const session = result?.session ?? null;
        if (error || !session) return { ok: false, reason: isNetworkError(error) ? 'offline' : 'generic' };
        onSession(session);
        return state.status === 'signedIn' ? { ok: true, user: state.user } : { ok: false, reason: 'generic' };
      } catch {
        return { ok: false, reason: isOnline() ? 'generic' : 'offline' };
      }
    },

    async signInWithRedirect(redirectTo) {
      try {
        const { error } = await client.signInWithOAuth({
          provider: 'google',
          options: { redirectTo, queryParams: { prompt: 'select_account' } },
        });
        return { ok: !error };
      } catch {
        return { ok: false };
      }
    },

    async exchangeCode(code) {
      try {
        const { data: result, error } = await client.exchangeCodeForSession(code);
        const session = result?.session ?? null;
        if (session && !error) {
          onSession(session);
          return { ok: true };
        }
        if (isNetworkError(error)) return { ok: false, reason: 'offline' };
        const message = `${error?.name ?? ''} ${error?.code ?? ''} ${error?.message ?? ''}`;
        if (/verifier/i.test(message)) return { ok: false, reason: 'wrongContext' };
        if (/expired|invalid|not found|flow_state/i.test(message) || error?.status === 400 || error?.status === 404) {
          return { ok: false, reason: 'expired' };
        }
        return { ok: false, reason: 'generic' };
      } catch {
        return { ok: false, reason: isOnline() ? 'generic' : 'offline' };
      }
    },

    async signOut(beforeSignOut) {
      explicitSignOut = true;
      try {
        await beforeSignOut?.().catch((error: unknown) => console.error('[auth] sign-out clean-up failed', error));
        await client.signOut({ scope: 'local' }).catch(() => undefined);
      } finally {
        forget();
        set({ status: 'signedOut' });
        explicitSignOut = false;
      }
    },

    dispose() {
      data.subscription.unsubscribe();
      listeners.clear();
    },
  };
}
