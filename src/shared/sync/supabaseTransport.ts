/**
 * Real transport over supabase-js. Payloads are typed with the contract types and cast at this
 * boundary because src/shared/api/database.types.ts is still a placeholder.
 *
 * Import this module only from the app shell (session.ts loads it lazily): importing
 * src/shared/api/supabase.ts throws when the environment variables are missing, as in tests.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ApplyMutationsResponse,
  HouseholdDeletedNudge,
  HouseholdId,
  PullResponse,
  SyncNudge,
} from '@/domain/types';
import { type ChannelStatus, classifyError, type SyncTransport, TransportError } from './transport';

interface RpcResult {
  data: unknown;
  error: { code?: string; message: string } | null;
  status: number;
}
interface RpcBuilder extends PromiseLike<RpcResult> {
  abortSignal(signal: AbortSignal): RpcBuilder;
  retry?(enabled: boolean): RpcBuilder;
}
/** The slice of the client used here, without the generated Database types. */
interface LooseRpc {
  rpc(fn: string, args: Record<string, unknown>): RpcBuilder;
}

async function rpc<T>(client: SupabaseClient, fn: string, args: Record<string, unknown>, signal: AbortSignal) {
  let builder = (client as unknown as LooseRpc).rpc(fn, args).abortSignal(signal);
  // The engine owns retries and backoff (02 §8).
  if (typeof builder.retry === 'function') builder = builder.retry(false);
  let result: RpcResult;
  try {
    result = await builder;
  } catch (error) {
    throw new TransportError('transport', error instanceof Error ? error.message : String(error));
  }
  if (result.error) {
    const kind = classifyError(result.status, result.error.code);
    throw new TransportError(kind, `${fn}: ${result.error.code ?? result.status} ${result.error.message}`);
  }
  return result.data as T;
}

export function createSupabaseTransport(client: SupabaseClient): SyncTransport {
  return {
    applyMutations: (request, signal) =>
      rpc<ApplyMutationsResponse>(client, 'apply_mutations', { p_request: request }, signal),

    pullChanges: (request, signal) =>
      rpc<PullResponse>(
        client,
        'pull_changes',
        {
          p_household: request.householdId,
          p_since: request.since,
          ...(request.limit !== undefined ? { p_limit: request.limit } : {}),
        },
        signal,
      ),

    async refreshSession() {
      const { data, error } = await client.auth.refreshSession();
      return !error && !!data.session;
    },

    subscribe(householdId: HouseholdId, handlers) {
      let cancelled = false;
      let channel: ReturnType<SupabaseClient['channel']> | null = null;
      void (async () => {
        await client.realtime.setAuth();
        if (cancelled) return;
        channel = client
          .channel(`household:${householdId}`, { config: { private: true } })
          .on('broadcast', { event: 'sync' }, (message) => handlers.onSync(message.payload as SyncNudge))
          .on('broadcast', { event: 'household_deleted' }, (message) =>
            handlers.onHouseholdDeleted(message.payload as HouseholdDeletedNudge),
          )
          .subscribe((status) => {
            const mapped: ChannelStatus =
              status === 'SUBSCRIBED' ? 'subscribed' : status === 'CLOSED' ? 'closed' : 'error';
            handlers.onStatus(mapped);
          });
      })().catch(() => handlers.onStatus('error'));
      return () => {
        cancelled = true;
        if (channel) void client.removeChannel(channel);
      };
    },

    onTokenRefreshed(listener) {
      const { data } = client.auth.onAuthStateChange((event) => {
        if (event !== 'TOKEN_REFRESHED') return;
        void client.realtime.setAuth().finally(listener);
      });
      return () => data.subscription.unsubscribe();
    },
  };
}

/** Lazily loads the app's Supabase client and wraps it. */
export async function loadSupabaseTransport(): Promise<SyncTransport> {
  const { supabase } = await import('@/shared/api/supabase');
  return createSupabaseTransport(supabase as unknown as SupabaseClient);
}
