import { describe, expect, it } from 'vitest';
import { type SyncViewInput, syncView } from './syncView';

const base: SyncViewInput = {
  status: { kind: 'idle', lastSyncedAt: null },
  pendingCount: 0,
  attentionCount: 0,
  firstSync: false,
  hasHousehold: true,
  online: true,
  pendingVisible: false,
};

describe('syncView', () => {
  it('stays hidden when everything is sent, or before onboarding', () => {
    expect(syncView(base).state).toBeNull();
    expect(syncView({ ...base, hasHousehold: false, firstSync: true }).state).toBeNull();
  });

  it('follows the precedence of design 03 §2.3', () => {
    const offlineError = { kind: 'error', pendingCount: 2, retryAt: 0, reason: 'server' } as const;
    expect(syncView({ ...base, firstSync: true, attentionCount: 1 }).state).toBe('firstSync');
    expect(syncView({ ...base, attentionCount: 1, status: offlineError }).state).toBe('attention');
    expect(syncView({ ...base, status: offlineError, pendingCount: 2 }).state).toBe('error');
    expect(syncView({ ...base, online: false, pendingCount: 2 }).state).toBe('offlinePending');
    expect(syncView({ ...base, online: false }).state).toBe('offline');
  });

  it('offers retry on errors only, and leaves auth errors to the session banner', () => {
    expect(
      syncView({ ...base, status: { kind: 'error', pendingCount: 1, retryAt: 0, reason: 'transport' } }).retry,
    ).toBe(true);
    expect(
      syncView({ ...base, status: { kind: 'error', pendingCount: 1, retryAt: 0, reason: 'auth' } }).state,
    ).toBeNull();
  });

  it('shows pending changes only after the delay', () => {
    expect(syncView({ ...base, pendingCount: 3 }).state).toBeNull();
    expect(syncView({ ...base, pendingCount: 3, pendingVisible: true }).state).toBe('pending');
  });
});
