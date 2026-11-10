/** Fake `SyncTransport` over `FakeServer`, with fault injection. Test-only. */
import type {
  ApplyMutationsRequest,
  ApplyMutationsResponse,
  HouseholdId,
  PullRequest,
  PullResponse,
} from '@/domain/types';
import { type ChannelHandlers, type SyncTransport, TransportError, type TransportErrorKind } from '../transport';
import type { FakeServer } from './fakeServer';

export type Fault =
  /** The request fails before reaching the server. */
  | { kind: TransportErrorKind; before: true }
  /** The server processes the request, then the response is lost. */
  | { kind: 'transport'; before: false };

export class FakeTransport implements SyncTransport {
  readonly applyCalls: ApplyMutationsRequest[] = [];
  readonly pullCalls: PullRequest[] = [];
  readonly applyFaults: Fault[] = [];
  readonly pullFaults: Fault[] = [];
  /** Rewrites a response before it is returned (e.g. to inject `retry` results). */
  transformApply: ((r: ApplyMutationsResponse) => ApplyMutationsResponse) | null = null;
  refreshResult = true;
  refreshCalls = 0;
  channels = new Map<string, ChannelHandlers>();
  private tokenListeners = new Set<() => void>();

  constructor(
    readonly server: FakeServer,
    public userId: string,
  ) {}

  async applyMutations(request: ApplyMutationsRequest): Promise<ApplyMutationsResponse> {
    this.applyCalls.push(structuredClone(request));
    const fault = this.applyFaults.shift();
    if (fault?.before) throw new TransportError(fault.kind, 'injected');
    const response = this.server.applyMutations(structuredClone(request), this.userId);
    if (fault) throw new TransportError('transport', 'response lost');
    const out = structuredClone(response);
    return this.transformApply ? this.transformApply(out) : out;
  }

  async pullChanges(request: PullRequest): Promise<PullResponse> {
    this.pullCalls.push({ ...request });
    const fault = this.pullFaults.shift();
    if (fault) throw new TransportError(fault.kind, 'injected');
    return structuredClone(this.server.pullChanges(request, this.userId));
  }

  async refreshSession(): Promise<boolean> {
    this.refreshCalls += 1;
    return this.refreshResult;
  }

  subscribe(householdId: HouseholdId, handlers: ChannelHandlers): () => void {
    this.channels.set(householdId, handlers);
    handlers.onStatus('subscribed');
    return () => {
      if (this.channels.get(householdId) === handlers) this.channels.delete(householdId);
    };
  }

  onTokenRefreshed(listener: () => void): () => void {
    this.tokenListeners.add(listener);
    return () => this.tokenListeners.delete(listener);
  }

  fireTokenRefreshed() {
    for (const l of this.tokenListeners) l();
  }

  nudge(householdId: HouseholdId, syncId: number) {
    this.channels.get(householdId)?.onSync({ syncId });
  }
}
