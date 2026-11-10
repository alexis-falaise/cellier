import { describe, expect, it } from 'vitest';
import { decideRedirect, type GuardState, homeFor } from './guards';

const signedOut: GuardState = { auth: 'signedOut', household: 'unknown', removed: false, pendingInvite: null };
const member: GuardState = { auth: 'signedIn', household: 'member', removed: false, pendingInvite: null };
const noHousehold: GuardState = { auth: 'signedIn', household: 'none', removed: false, pendingInvite: null };
const removed: GuardState = { ...member, removed: true };
const expiredMember: GuardState = { ...member, auth: 'expired' };

const href = (state: GuardState, path: string) => decideRedirect(state, path)?.href ?? null;

describe('decideRedirect', () => {
  it('sends a signed-out visitor to /welcome', () => {
    expect(href(signedOut, '/')).toBe('/welcome');
    expect(href(signedOut, '/stock/items/abc')).toBe('/welcome');
    expect(href(signedOut, '/onboarding/create')).toBe('/welcome');
    expect(href(signedOut, '/removed')).toBe('/welcome');
    expect(href(signedOut, '/welcome')).toBeNull();
  });

  it('keeps public routes reachable whatever the session', () => {
    for (const state of [signedOut, member, noHousehold, removed]) {
      expect(href(state, '/auth/callback')).toBeNull();
      expect(href(state, '/join')).toBeNull();
      expect(href(state, '/legal/terms')).toBeNull();
    }
  });

  it('sends a signed-in user without a household to onboarding', () => {
    expect(href(noHousehold, '/')).toBe('/onboarding/household');
    expect(href(noHousehold, '/welcome')).toBe('/onboarding/household');
    expect(href(noHousehold, '/onboarding/household')).toBeNull();
    expect(href(noHousehold, '/onboarding/create')).toBeNull();
    expect(href(noHousehold, '/onboarding/join')).toBeNull();
    expect(href(noHousehold, '/onboarding/joined')).toBe('/onboarding/household');
  });

  it('resumes a pending invite after sign-in', () => {
    const pending = { ...noHousehold, pendingInvite: 'K7PM4QXD' };
    expect(href(pending, '/')).toBe('/onboarding/join?code=K7PM4QXD');
    expect(href(pending, '/onboarding/join')).toBeNull();
  });

  it('treats an unresolved membership like no household (offline new device)', () => {
    expect(href({ ...noHousehold, household: 'unknown' }, '/')).toBe('/onboarding/household');
  });

  it('lets a member into the app and out of onboarding', () => {
    expect(href(member, '/')).toBeNull();
    expect(href(member, '/groceries/items/x/history')).toBeNull();
    expect(href(member, '/welcome')).toBe('/');
    expect(href(member, '/onboarding/create')).toBe('/');
    expect(href(member, '/onboarding/joined')).toBeNull();
    expect(href(member, '/removed')).toBe('/');
  });

  it('confines a removed member to /removed', () => {
    expect(href(removed, '/')).toBe('/removed');
    expect(href(removed, '/stock')).toBe('/removed');
    expect(href(removed, '/removed')).toBeNull();
    expect(href(removed, '/welcome')).toBe('/removed');
  });

  it('keeps an expired session on local data, and signs in again without one', () => {
    expect(href(expiredMember, '/')).toBeNull();
    expect(href(expiredMember, '/welcome')).toBe('/');
    const expiredNew: GuardState = { ...noHousehold, auth: 'expired' };
    expect(href(expiredNew, '/')).toBe('/welcome');
    expect(href(expiredNew, '/welcome')).toBeNull();
    expect(href(expiredNew, '/onboarding/create')).toBe('/welcome');
  });

  it('ignores a trailing slash', () => {
    expect(href(member, '/onboarding/create/')).toBe('/');
    expect(href(noHousehold, '/onboarding/create/')).toBeNull();
  });
});

describe('homeFor', () => {
  it('names the landing place of each situation', () => {
    expect(homeFor(signedOut)).toBe('/welcome');
    expect(homeFor(member)).toBe('/');
    expect(homeFor(removed)).toBe('/removed');
    expect(homeFor(noHousehold)).toBe('/onboarding/household');
  });
});
