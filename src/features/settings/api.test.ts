import { describe, expect, it, vi } from 'vitest';
import type { HouseholdId } from '@/domain/types';
import { classifyError, createSettingsApi, type SettingsClient } from './api';

function fakeClient(result: { data: unknown; error: { message: string } | null }) {
  const rpc = vi.fn(async () => result);
  const query = {
    eq: () => query,
    is: () => query,
    gt: () => query,
    order: () => query,
    // biome-ignore lint/suspicious/noThenProperty: a Supabase query builder is thenable
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
  };
  const client = { rpc, from: () => ({ select: () => query }) } as unknown as SettingsClient;
  return { client, rpc };
}

const household = 'h1' as HouseholdId;

describe('classifyError', () => {
  it('reads the business error key', () => {
    expect(classifyError({ message: 'owner_must_transfer' }, true)).toBe('owner_must_transfer');
    expect(classifyError(new Error('not_owner: forbidden'), true)).toBe('not_owner');
  });
  it('treats network failures and offline as offline', () => {
    expect(classifyError(new TypeError('Failed to fetch'), true)).toBe('offline');
    expect(classifyError({ message: 'boom' }, false)).toBe('offline');
    expect(classifyError({ message: 'boom' }, true)).toBe('error');
  });
});

describe('createSettingsApi', () => {
  it('does not call the server offline', async () => {
    const { client, rpc } = fakeClient({ data: null, error: null });
    const api = createSettingsApi(client, () => false);
    expect(await api.leaveHousehold(household)).toEqual({ ok: false, reason: 'offline' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('passes the RPC arguments', async () => {
    const { client, rpc } = fakeClient({ data: null, error: null });
    const api = createSettingsApi(client, () => true);
    expect(await api.deleteHousehold(household)).toEqual({ ok: true, value: undefined });
    expect(rpc).toHaveBeenCalledWith('delete_household', { p_household_id: 'h1' });
  });

  it('maps a business error', async () => {
    const { client } = fakeClient({ data: null, error: { message: 'owner_must_transfer' } });
    const api = createSettingsApi(client, () => true);
    expect(await api.leaveHousehold(household)).toEqual({ ok: false, reason: 'owner_must_transfer' });
  });

  it('lists only invites with uses left', async () => {
    const row = (id: string, uses: number) => ({
      id,
      created_at: '2026-11-10T10:00:00Z',
      expires_at: '2026-11-17T10:00:00Z',
      uses,
      max_uses: 1,
      revoked_at: null,
    });
    const { client } = fakeClient({ data: [row('a', 0), row('b', 1)], error: null });
    const api = createSettingsApi(client, () => true);
    const result = await api.listPendingInvites(household);
    expect(result.ok && result.value.map((i) => i.id)).toEqual(['a']);
  });
});
