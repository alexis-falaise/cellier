/**
 * The engine's only door to the network. The real implementation (supabaseTransport.ts) wraps the
 * Supabase client; tests inject a fake. Errors are classified per 02 §8 by throwing `TransportError`.
 */
import type {
  ApplyMutationsRequest,
  ApplyMutationsResponse,
  HouseholdDeletedNudge,
  HouseholdId,
  PullRequest,
  PullResponse,
  SyncNudge,
} from '@/domain/types';

export type TransportErrorKind = 'transport' | 'auth' | 'server' | 'contract';

export class TransportError extends Error {
  constructor(
    readonly kind: TransportErrorKind,
    message: string,
    /** Server-requested delay (HTTP 429 `Retry-After`), in ms. */
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'TransportError';
  }
}

export type ChannelStatus = 'subscribed' | 'closed' | 'error';

export interface ChannelHandlers {
  onSync(nudge: SyncNudge): void;
  onHouseholdDeleted(nudge: HouseholdDeletedNudge): void;
  onStatus(status: ChannelStatus): void;
}

export interface SyncTransport {
  applyMutations(request: ApplyMutationsRequest, signal: AbortSignal): Promise<ApplyMutationsResponse>;
  pullChanges(request: PullRequest, signal: AbortSignal): Promise<PullResponse>;
  /** Refreshes the auth session once; resolves false when the user must sign in again. */
  refreshSession(): Promise<boolean>;
  /** Joins the private channel `household:<id>`; returns a function that leaves it. */
  subscribe(householdId: HouseholdId, handlers: ChannelHandlers): () => void;
  /** Calls `listener` on TOKEN_REFRESHED (after updating the realtime auth). */
  onTokenRefreshed(listener: () => void): () => void;
}

/** Classifies a PostgREST/Postgres error code and HTTP status per 02 §8. */
export function classifyError(status: number | undefined, code: string | undefined): TransportErrorKind {
  if (status === 401 || code === 'PGRST301' || code === 'PGRST303' || code === '28000') return 'auth';
  if (code === '22023' || code === '54000' || code === 'PGRST202') return 'contract';
  if (code === '40001' || code === '40P01' || code === '55P03' || code === '57014') return 'server';
  if (status === undefined || status === 0) return 'transport';
  if (status >= 500 || status === 408 || status === 429) return 'server';
  if (status === 400) return 'contract';
  return 'server';
}

/** Parses `Retry-After` (seconds or HTTP date) into ms. */
export function parseRetryAfter(value: string | null | undefined, now: number = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}
