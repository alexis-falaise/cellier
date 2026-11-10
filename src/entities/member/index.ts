/** Household and member selectors and hooks. */
import type { Household, Member } from '@/domain/types';
import { useStore } from '@/shared/sync';
import { compareFr, createSelector, keyedSelector, type Selector } from '../lib/selector';

export const selectHousehold: Selector<Household | null> = (s) =>
  (s.householdId ? s.rows.household.get(s.householdId) : undefined) ?? null;

/** Members, owner first, then by display name. */
export const selectMembers: Selector<readonly Member[]> = createSelector(
  (s) => [s.rows.member] as const,
  (members) =>
    [...members.values()].sort(
      (a, b) => (a.role === 'owner' ? 0 : 1) - (b.role === 'owner' ? 0 : 1) || compareFr(a.displayName, b.displayName),
    ),
);

export const selectMember = keyedSelector(
  (userId: string): Selector<Member | undefined> =>
    (s) =>
      s.rows.member.get(userId),
);

/** The signed-in user's member row. */
export const selectMe: Selector<Member | undefined> = (s) => (s.userId ? s.rows.member.get(s.userId) : undefined);

export const selectIsOwner: Selector<boolean> = (s) => selectMe(s)?.role === 'owner';

export function useHousehold(): Household | null {
  return useStore(selectHousehold);
}

export function useMembers(): readonly Member[] {
  return useStore(selectMembers);
}

export function useMember(userId: string | null): Member | undefined {
  return useStore(userId ? selectMember(userId) : selectNobody);
}

export function useMe(): Member | undefined {
  return useStore(selectMe);
}

export function useIsOwner(): boolean {
  return useStore(selectIsOwner);
}

const selectNobody: Selector<undefined> = () => undefined;
