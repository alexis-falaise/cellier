import type { Member, UserId } from '@/domain/types';
import type { PushStatus } from '@/features/notifications';

export type AccountDeletion =
  | { kind: 'member' }
  | { kind: 'alone' }
  /** `delete_account` hands the household to the longest-standing other member (00-decisions). */
  | { kind: 'transfer'; successor: Member };

export function accountDeletion(me: UserId, members: readonly Member[]): AccountDeletion {
  const self = members.find((m) => m.userId === me);
  if (self?.role !== 'owner') return { kind: 'member' };
  const successor = members
    .filter((m) => m.userId !== me)
    .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt) || a.userId.localeCompare(b.userId))[0];
  return successor ? { kind: 'transfer', successor } : { kind: 'alone' };
}

/** Value of the «Notifications» row on the Réglages root (03 §4.10). */
export function notificationsSummary(
  status: PushStatus['kind'],
  vapidKey: string | undefined,
): 'on' | 'off' | 'notInstalled' {
  if (status === 'needs-install') return 'notInstalled';
  return status === 'subscribed' && vapidKey ? 'on' : 'off';
}

/** Initials for an avatar without a photo. */
export function initials(name: string | null | undefined, fallback = '?'): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return fallback;
  return words
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase();
}
