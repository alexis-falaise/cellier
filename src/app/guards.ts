/**
 * Route guards (design 03 §1.5, §4.1.1, §4.16), as a pure decision over the session state so that
 * the rules are testable without a router. The root route's `beforeLoad` calls `decideRedirect`
 * with the settled state and throws a redirect when it returns a target.
 */

export type AuthPhase = 'signedOut' | 'signedIn' | 'expired';
/** `unknown`: signed in but membership not resolved (offline on a new device). */
export type HouseholdPhase = 'none' | 'member' | 'unknown';

export interface GuardState {
  auth: AuthPhase;
  household: HouseholdPhase;
  /** Membership revoked or household deleted (sync notice). */
  removed: boolean;
  /** Invite code kept across sign-in (from `/join#CODE`). */
  pendingInvite: string | null;
}

export interface Redirect {
  href: string;
}

/** Always reachable, whatever the session. */
const PUBLIC_PREFIXES = ['/auth/callback', '/join', '/legal/', '/dev/'];
/** First onboarding steps, shown only to a signed-in user without a household. */
const ONBOARDING_SETUP = ['/onboarding/household', '/onboarding/create', '/onboarding/join'];

function normalise(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

function isPublic(path: string): boolean {
  return PUBLIC_PREFIXES.some((p) => (p.endsWith('/') ? path.startsWith(p) : path === p || path.startsWith(`${p}/`)));
}

function onboardingTarget(state: GuardState): string {
  return state.pendingInvite
    ? `/onboarding/join?code=${encodeURIComponent(state.pendingInvite)}`
    : '/onboarding/household';
}

/** Where a signed-in user with a resolved situation belongs. */
export function homeFor(state: GuardState): string {
  if (state.auth === 'signedOut') return '/welcome';
  if (state.household === 'member') return state.removed ? '/removed' : '/';
  if (state.auth === 'expired') return '/welcome';
  return onboardingTarget(state);
}

export function decideRedirect(state: GuardState, pathname: string): Redirect | null {
  const path = normalise(pathname);
  if (isPublic(path)) return null;
  const to = (href: string): Redirect | null => (href.split('?')[0] === path ? null : { href });

  if (path === '/welcome') {
    // Signed-in users never see the welcome screen; an expired session without a known household
    // has nothing local to show, so it signs in again from here.
    if (state.auth === 'signedOut') return null;
    if (state.auth === 'expired' && state.household !== 'member') return null;
    return to(homeFor(state));
  }

  if (state.auth === 'signedOut') return to('/welcome');

  if (path === '/removed') {
    return state.household === 'member' && state.removed ? null : to(homeFor(state));
  }

  if (path.startsWith('/onboarding/')) {
    if (state.auth === 'expired') return to(homeFor(state));
    if (path === '/onboarding/joined') return state.household === 'member' ? null : to(onboardingTarget(state));
    if (ONBOARDING_SETUP.includes(path)) return state.household === 'member' ? to(homeFor(state)) : null;
    return to(homeFor(state));
  }

  // App routes: a household is required; an expired session keeps working on local data.
  if (state.household !== 'member') return to(homeFor(state));
  if (state.removed) return to('/removed');
  return null;
}
