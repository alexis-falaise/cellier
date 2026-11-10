import { describe, expect, it } from 'vitest';
import type { CategoryId, CreateInviteResult, HouseholdId, InviteListItem, Member, UserId } from '@/domain/types';
import { accountDeletion, initials, notificationsSummary } from './account';
import { categoryKind, moveItem, nextSortOrder, reorderPlan, validateCategoryName } from './categories';
import { inviteUrl, reusableInvite } from './invite';
import { parentPage, settingsStack } from './pages';
import { dropIndex, rowShift, slotOffset } from './reorder';

const cat = (id: string, sortOrder: number) => ({ id: id as CategoryId, sortOrder });

describe('settingsStack', () => {
  it('starts at the root', () => {
    expect(settingsStack(undefined).map((e) => e.key)).toEqual(['root']);
  });

  it('rebuilds the pages under a deep link', () => {
    expect(settingsStack('member', 'u1').map((e) => e.key)).toEqual(['root', 'household', 'member:u1']);
    expect(settingsStack('category-new').map((e) => e.page)).toEqual(['root', 'categories', 'category-new']);
  });

  it('shows the parent of a page that needs an id and has none', () => {
    expect(settingsStack('category').map((e) => e.key)).toEqual(['root', 'categories']);
  });

  it('names the page under each page for the back button', () => {
    expect(parentPage('invite')).toBe('household');
    expect(parentPage('account')).toBe('root');
  });
});

describe('category order', () => {
  const list = [cat('a', 10), cat('b', 20), cat('c', 30)];

  it('moves an item', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
  });

  it('writes only the moved row when there is room', () => {
    expect(reorderPlan(list, 2, 0)).toEqual([{ id: 'c', sortOrder: 0 }]);
    expect(reorderPlan(list, 0, 2)).toEqual([{ id: 'a', sortOrder: 40 }]);
    expect(reorderPlan(list, 0, 1)).toEqual([{ id: 'a', sortOrder: 25 }]);
  });

  it('renumbers when the neighbours are adjacent', () => {
    const tight = [cat('a', 1), cat('b', 2), cat('c', 3)];
    expect(reorderPlan(tight, 2, 1)).toEqual([
      { id: 'a', sortOrder: 10 },
      { id: 'c', sortOrder: 20 },
      { id: 'b', sortOrder: 30 },
    ]);
  });

  it('does nothing for a drop in place', () => {
    expect(reorderPlan(list, 1, 1)).toEqual([]);
  });

  it('appends new categories', () => {
    expect(nextSortOrder(list)).toBe(40);
    expect(nextSortOrder([])).toBe(10);
  });
});

describe('category names', () => {
  const list = [
    { id: 'a' as CategoryId, name: 'Épicerie' },
    { id: 'b' as CategoryId, name: 'Boissons' },
  ];
  it('requires a name', () => {
    expect(validateCategoryName('  ', list, null)).toBe('required');
  });
  it('rejects a name taken ignoring case and accents', () => {
    expect(validateCategoryName('epicerie', list, null)).toBe('taken');
    expect(validateCategoryName('Epicerie', list, 'a')).toBeNull();
  });
  it('classifies categories', () => {
    expect(categoryKind({ templateKey: 'autre' })).toBe('others');
    expect(categoryKind({ templateKey: null })).toBe('custom');
  });
});

describe('invites', () => {
  const now = Date.parse('2026-11-10T12:00:00Z');
  const cached: CreateInviteResult = {
    inviteId: 'i1',
    code: 'ABCD2345',
    expiresAt: '2026-11-17T12:00:00Z',
  } as CreateInviteResult;
  const pending: InviteListItem = {
    id: 'i1',
    createdAt: '2026-11-10T11:00:00Z',
    expiresAt: '2026-11-17T12:00:00Z',
    uses: 0,
    revokedAt: null,
  } as InviteListItem;

  it('builds the share link with the code in the fragment', () => {
    expect(inviteUrl('https://cellier.app/', 'ABCD2345')).toBe('https://cellier.app/join#ABCD2345');
  });

  it('reuses a pending code', () => {
    expect(reusableInvite(cached, [pending], now)).toBe(cached);
  });

  it('creates a new code when the last one is used, revoked, gone or about to expire', () => {
    expect(reusableInvite(cached, [{ ...pending, uses: 1 }], now)).toBeNull();
    expect(reusableInvite(cached, [], now)).toBeNull();
    expect(reusableInvite(cached, [pending], Date.parse('2026-11-17T11:30:00Z'))).toBeNull();
    expect(reusableInvite(undefined, [pending], now)).toBeNull();
  });
});

describe('account deletion', () => {
  const member = (userId: string, role: 'owner' | 'member', joinedAt: string): Member =>
    ({
      householdId: 'h' as HouseholdId,
      userId: userId as UserId,
      role,
      displayName: userId,
      avatarUrl: null,
      notifyRunningLow: true,
      notifyDigest: true,
      joinedAt,
    }) as Member;

  it('leaves the household of a member', () => {
    expect(
      accountDeletion('me' as UserId, [member('me', 'member', '2026-01-01'), member('o', 'owner', '2025-01-01')]),
    ).toEqual({
      kind: 'member',
    });
  });

  it('deletes the household of an owner alone', () => {
    expect(accountDeletion('me' as UserId, [member('me', 'owner', '2026-01-01')])).toEqual({ kind: 'alone' });
  });

  it('hands the household to the longest-standing member', () => {
    const result = accountDeletion('me' as UserId, [
      member('me', 'owner', '2025-01-01'),
      member('late', 'member', '2026-03-01'),
      member('early', 'member', '2025-06-01'),
    ]);
    expect(result.kind === 'transfer' && result.successor.userId).toBe('early');
  });

  it('summarises notifications and initials', () => {
    expect(notificationsSummary('subscribed', 'key')).toBe('on');
    expect(notificationsSummary('subscribed', undefined)).toBe('off');
    expect(notificationsSummary('needs-install', 'key')).toBe('notInstalled');
    expect(initials('Marie Claire Dupont')).toBe('MC');
    expect(initials(null)).toBe('?');
  });
});

describe('reorder geometry', () => {
  const rows = [
    { top: 0, height: 44 },
    { top: 44, height: 60 },
    { top: 104, height: 44 },
  ];
  it('finds the drop slot from the dragged centre', () => {
    expect(dropIndex(rows, 0, 0)).toBe(0);
    expect(dropIndex(rows, 0, 60)).toBe(1);
    expect(dropIndex(rows, 0, 120)).toBe(2);
    expect(dropIndex(rows, 2, -120)).toBe(0);
  });
  it('shifts neighbours by the dragged height', () => {
    expect(rowShift(1, 0, 2, 44)).toBe(-44);
    expect(rowShift(0, 2, 0, 44)).toBe(44);
    expect(rowShift(2, 0, 1, 44)).toBe(0);
  });
  it('places the dragged row in its slot', () => {
    expect(slotOffset(rows, 0, 2)).toBe(104);
    expect(slotOffset(rows, 2, 0)).toBe(-104);
  });
});
