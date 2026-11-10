/**
 * Online-only household and account RPCs of Réglages (supabase/migrations/…_household_rpcs.sql).
 * They are not sync mutations: they need the network, so callers disable the action offline.
 * Business errors arrive as SQLSTATE P0001 with a stable key in the message (contract
 * `HouseholdRpcError`).
 *
 *   const api = await loadSettingsApi();
 *   const result = await api.createInvite(householdId);
 */
import type {
  CreateInviteResult,
  HouseholdId,
  HouseholdRpcError,
  InviteListItem,
  IsoDateTime,
  UserId,
} from '@/domain/types';
import { isOnline } from '@/features/auth';

interface ResultLike {
  data: unknown;
  error: { message: string; code?: string | undefined } | null;
}

interface InviteQuery extends PromiseLike<ResultLike> {
  eq(column: string, value: string): InviteQuery;
  is(column: string, value: null): InviteQuery;
  gt(column: string, value: string): InviteQuery;
  order(column: string, options: { ascending: boolean }): InviteQuery;
}

/** Subset of the Supabase client used here; pass `supabase as unknown as SettingsClient` at the boundary. */
export interface SettingsClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<ResultLike>;
  from(table: 'household_invites'): { select(columns: string): InviteQuery };
}

export type SettingsFailure = 'offline' | 'error' | HouseholdRpcError;
export type SettingsResult<T = void> = { ok: true; value: T } | { ok: false; reason: SettingsFailure };

const RPC_ERRORS: readonly HouseholdRpcError[] = [
  'not_authenticated',
  'not_member',
  'not_owner',
  'household_exists',
  'too_many_households',
  'owner_must_transfer',
  'cannot_remove_owner',
  'target_not_member',
  'invalid_argument',
];

/** Maps a thrown or returned error to a failure reason. */
export function classifyError(error: unknown, online: boolean): SettingsFailure {
  const message = error instanceof Error ? error.message : String((error as { message?: unknown })?.message ?? '');
  const key = RPC_ERRORS.find((k) => new RegExp(`\\b${k}\\b`).test(message));
  if (key) return key;
  if (!online || /fetch|network|load failed/i.test(message)) return 'offline';
  return 'error';
}

export interface SettingsApi {
  createInvite(householdId: HouseholdId): Promise<SettingsResult<CreateInviteResult>>;
  /** Unused, unrevoked, unexpired invites of the household (owner only, RLS). */
  listPendingInvites(householdId: HouseholdId): Promise<SettingsResult<InviteListItem[]>>;
  revokeInvite(inviteId: string): Promise<SettingsResult>;
  removeMember(householdId: HouseholdId, userId: UserId): Promise<SettingsResult>;
  transferOwnership(householdId: HouseholdId, userId: UserId): Promise<SettingsResult>;
  leaveHousehold(householdId: HouseholdId): Promise<SettingsResult>;
  deleteHousehold(householdId: HouseholdId): Promise<SettingsResult>;
  deleteAccount(): Promise<SettingsResult>;
}

interface InviteRow {
  id: string;
  created_at: IsoDateTime;
  expires_at: IsoDateTime;
  uses: number;
  max_uses: number;
  revoked_at: IsoDateTime | null;
}

export function createSettingsApi(
  client: SettingsClient,
  online: () => boolean = isOnline,
  now: () => number = Date.now,
): SettingsApi {
  async function call<T>(run: () => PromiseLike<ResultLike>, read: (data: unknown) => T): Promise<SettingsResult<T>> {
    if (!online()) return { ok: false, reason: 'offline' };
    try {
      const { data, error } = await run();
      if (error) return { ok: false, reason: classifyError(error, online()) };
      return { ok: true, value: read(data) };
    } catch (error) {
      return { ok: false, reason: classifyError(error, online()) };
    }
  }
  const none = () => undefined;

  return {
    createInvite: (householdId) =>
      call(
        () => client.rpc('create_invite', { p_household_id: householdId }),
        (data) => data as CreateInviteResult,
      ),

    listPendingInvites: (householdId) =>
      call(
        () =>
          client
            .from('household_invites')
            .select('id, created_at, expires_at, uses, max_uses, revoked_at')
            .eq('household_id', householdId)
            .is('revoked_at', null)
            .gt('expires_at', new Date(now()).toISOString())
            .order('created_at', { ascending: false }),
        (data) =>
          ((data as InviteRow[] | null) ?? [])
            .filter((row) => row.uses < row.max_uses)
            .map((row) => ({
              id: row.id,
              createdAt: row.created_at,
              expiresAt: row.expires_at,
              uses: row.uses,
              revokedAt: row.revoked_at,
            })),
      ),

    revokeInvite: (inviteId) => call(() => client.rpc('revoke_invite', { p_invite_id: inviteId }), none),
    removeMember: (householdId, userId) =>
      call(() => client.rpc('remove_member', { p_household_id: householdId, p_user_id: userId }), none),
    transferOwnership: (householdId, userId) =>
      call(() => client.rpc('transfer_ownership', { p_household_id: householdId, p_user_id: userId }), none),
    leaveHousehold: (householdId) => call(() => client.rpc('leave_household', { p_household_id: householdId }), none),
    deleteHousehold: (householdId) => call(() => client.rpc('delete_household', { p_household_id: householdId }), none),
    deleteAccount: () => call(() => client.rpc('delete_account', {}), none),
  };
}

let loading: Promise<SettingsApi> | null = null;

/** The API on the app's Supabase client, loaded lazily (the client module throws without its env vars). */
export function loadSettingsApi(): Promise<SettingsApi> {
  loading ??= import('@/shared/api/supabase')
    .then(({ supabase }) => createSettingsApi(supabase as unknown as SettingsClient))
    .catch((error: unknown) => {
      loading = null;
      throw error;
    });
  return loading;
}

/** Same as `loadSettingsApi`, but a missing client becomes an `error` result of the call. */
export async function withSettingsApi<T>(
  run: (api: SettingsApi) => Promise<SettingsResult<T>>,
): Promise<SettingsResult<T>> {
  let api: SettingsApi;
  try {
    api = await loadSettingsApi();
  } catch {
    return { ok: false, reason: isOnline() ? 'error' : 'offline' };
  }
  return run(api);
}
