import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPendingInvite,
  formatInviteCode,
  inviteCodeFromHash,
  isCompleteInviteCode,
  normalizeInviteCode,
  readPendingInvite,
  savePendingInvite,
  spellInviteCode,
} from './inviteCode';

describe('invite codes', () => {
  it('normalises like the server: case, separators, ambiguous letters', () => {
    expect(normalizeInviteCode('k7pm-4qxd')).toBe('K7PM4QXD');
    expect(normalizeInviteCode(' K7PM 4QXD ')).toBe('K7PM4QXD');
    expect(normalizeInviteCode('oil0')).toBe('0110');
    expect(normalizeInviteCode('ABCU')).toBe('ABC');
    expect(normalizeInviteCode('K7PM4QXDZZ')).toBe('K7PM4QXD');
  });

  it('formats with a hyphen after four characters', () => {
    expect(formatInviteCode('k7pm')).toBe('K7PM');
    expect(formatInviteCode('k7pm4')).toBe('K7PM-4');
    expect(formatInviteCode('K7PM4QXD')).toBe('K7PM-4QXD');
  });

  it('needs eight characters', () => {
    expect(isCompleteInviteCode('K7PM-4QX')).toBe(false);
    expect(isCompleteInviteCode('K7PM-4QXD')).toBe(true);
  });

  it('spells the code for VoiceOver', () => {
    expect(spellInviteCode('K7PM-4QXD')).toBe('K 7 P M 4 Q X D');
  });

  it('reads the code from an invite link fragment', () => {
    expect(inviteCodeFromHash('#K7PM-4QXD')).toBe('K7PM4QXD');
    expect(inviteCodeFromHash('#k7pm4qxd')).toBe('K7PM4QXD');
    expect(inviteCodeFromHash('https://cellier.app/join#K7PM%2D4QXD')).toBe('K7PM4QXD');
    expect(inviteCodeFromHash('#K7PM')).toBeNull();
    expect(inviteCodeFromHash('')).toBeNull();
  });
});

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, v),
  };
}

describe('pending invite', () => {
  beforeEach(() => vi.stubGlobal('sessionStorage', memoryStorage()));
  afterEach(() => {
    clearPendingInvite();
    vi.unstubAllGlobals();
  });

  it('survives in session storage until cleared', () => {
    savePendingInvite('k7pm-4qxd');
    expect(readPendingInvite()).toBe('K7PM4QXD');
    clearPendingInvite();
    expect(readPendingInvite()).toBeNull();
  });

  it('ignores an incomplete code', () => {
    savePendingInvite('K7PM');
    expect(readPendingInvite()).toBeNull();
  });
});
