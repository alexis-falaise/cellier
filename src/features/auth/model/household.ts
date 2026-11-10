/**
 * Membership and household onboarding RPCs (docs/architecture/01-data-model.md §4): membership
 * lookup after sign-in, `create_household`, `peek_invite` (anon, before sign-in) and
 * `accept_invite`. The Supabase client is injected (`supabase as unknown as HouseholdClient`).
 */
import type {
  AcceptInviteResult,
  CreateHouseholdResult,
  HouseholdId,
  InvitePeek,
  PantryId,
  UserId,
} from '@/domain/types';

interface ResultLike {
  data: unknown;
  error: { message: string; code?: string | undefined; status?: number | undefined } | null;
}

export interface HouseholdClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<ResultLike>;
  from(table: 'household_members'): {
    select(columns: string): {
      eq(
        column: 'user_id',
        value: string,
      ): {
        order(column: string, options: { ascending: boolean }): { limit(n: number): PromiseLike<ResultLike> };
      };
    };
  };
}

export type Failure = 'offline' | 'error';

/** Online check and network classification shared by the calls below. */
function failure(error: unknown, isOnline: () => boolean): Failure {
  if (!isOnline()) return 'offline';
  const message = error instanceof Error ? error.message : String((error as { message?: unknown })?.message ?? '');
  return /fetch|network|load failed/i.test(message) ? 'offline' : 'error';
}

export interface HouseholdApi {
  /** The household of this account (one per account in v1; the oldest membership wins). */
  fetchMembership(
    userId: UserId,
  ): Promise<{ ok: true; householdId: HouseholdId | null } | { ok: false; reason: Failure }>;
  createHousehold(args: {
    householdId: HouseholdId;
    name: string;
    pantryId: PantryId;
    pantryName: string;
  }): Promise<{ ok: true; householdId: HouseholdId } | { ok: false; reason: Failure | 'exists' }>;
  peekInvite(code: string): Promise<{ ok: true; peek: InvitePeek } | { ok: false; reason: Failure }>;
  acceptInvite(code: string): Promise<{ ok: true; result: AcceptInviteResult } | { ok: false; reason: Failure }>;
}

export function createHouseholdApi(client: HouseholdClient, isOnline: () => boolean = () => true): HouseholdApi {
  return {
    async fetchMembership(userId) {
      if (!isOnline()) return { ok: false, reason: 'offline' };
      try {
        const { data, error } = await client
          .from('household_members')
          .select('household_id, joined_at')
          .eq('user_id', userId)
          .order('joined_at', { ascending: true })
          .limit(1);
        if (error) return { ok: false, reason: failure(error, isOnline) };
        const row = Array.isArray(data) ? (data[0] as { household_id?: string } | undefined) : undefined;
        return { ok: true, householdId: (row?.household_id as HouseholdId | undefined) ?? null };
      } catch (error) {
        return { ok: false, reason: failure(error, isOnline) };
      }
    },

    async createHousehold({ householdId, name, pantryId, pantryName }) {
      if (!isOnline()) return { ok: false, reason: 'offline' };
      try {
        const { data, error } = await client.rpc('create_household', {
          p_household_id: householdId,
          p_name: name,
          p_pantry_id: pantryId,
          p_pantry_name: pantryName,
        });
        if (error) {
          if (/household_exists/.test(error.message)) return { ok: false, reason: 'exists' };
          return { ok: false, reason: failure(error, isOnline) };
        }
        const result = data as CreateHouseholdResult | null;
        return { ok: true, householdId: result?.householdId ?? householdId };
      } catch (error) {
        return { ok: false, reason: failure(error, isOnline) };
      }
    },

    async peekInvite(code) {
      if (!isOnline()) return { ok: false, reason: 'offline' };
      try {
        const { data, error } = await client.rpc('peek_invite', { p_code: code });
        if (error || !data) return { ok: false, reason: failure(error, isOnline) };
        return { ok: true, peek: data as InvitePeek };
      } catch (error) {
        return { ok: false, reason: failure(error, isOnline) };
      }
    },

    async acceptInvite(code) {
      if (!isOnline()) return { ok: false, reason: 'offline' };
      try {
        const { data, error } = await client.rpc('accept_invite', { p_code: code });
        if (error || !data) return { ok: false, reason: failure(error, isOnline) };
        return { ok: true, result: data as AcceptInviteResult };
      } catch (error) {
        return { ok: false, reason: failure(error, isOnline) };
      }
    },
  };
}

/** Copy key for an invite status that blocks joining (design 03 §4.1.6). */
export type InviteErrorKey =
  | 'onboarding.join.error.notFound'
  | 'onboarding.join.error.expired'
  | 'onboarding.join.error.used'
  | 'onboarding.join.error.rateLimited';

export function inviteErrorKey(status: InvitePeek['status'] | AcceptInviteResult['status']): InviteErrorKey | null {
  switch (status) {
    case 'not_found':
      return 'onboarding.join.error.notFound';
    case 'expired':
    case 'revoked':
      return 'onboarding.join.error.expired';
    case 'used_up':
      return 'onboarding.join.error.used';
    case 'rate_limited':
      return 'onboarding.join.error.rateLimited';
    default:
      return null;
  }
}
