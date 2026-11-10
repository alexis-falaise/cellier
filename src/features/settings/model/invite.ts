/**
 * Invitations (design 03 §4.12.3): the owner creates a single-use code valid 7 days, shown once
 * (only its hash is stored). The code created on this device is kept in memory and shown again
 * while it is still pending, so reopening the page does not pile up unused codes.
 */
import type { CreateInviteResult, HouseholdId, InviteListItem } from '@/domain/types';

/** `https://<origin>/join#XXXXXXXX` (the fragment never reaches a server log). */
export function inviteUrl(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, '')}/join#${code}`;
}

/** The invite shown last time, if it is still pending and valid for at least another hour. */
export function reusableInvite(
  cached: CreateInviteResult | undefined,
  pending: readonly InviteListItem[],
  now: number,
): CreateInviteResult | null {
  if (!cached) return null;
  const listed = pending.find((p) => p.id === cached.inviteId);
  if (!listed || listed.revokedAt !== null || listed.uses > 0) return null;
  return Date.parse(cached.expiresAt) - now > 3600_000 ? cached : null;
}

const shown = new Map<HouseholdId, CreateInviteResult>();

export const inviteMemory = {
  get: (householdId: HouseholdId): CreateInviteResult | undefined => shown.get(householdId),
  set: (householdId: HouseholdId, invite: CreateInviteResult): void => {
    shown.set(householdId, invite);
  },
  forget: (inviteId: string): void => {
    for (const [k, v] of shown) if (v.inviteId === inviteId) shown.delete(k);
  },
};
