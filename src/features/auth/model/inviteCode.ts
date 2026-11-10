/**
 * Invite codes: 8 Crockford base-32 characters (`0-9`, `A-Z` without I, L, O, U), shown as
 * `XXXX-XXXX` (design 03 §4.1.6). Typed input is normalised the way the server does it
 * (`private.normalize_invite_code`): upper case, separators removed, I/L → 1, O → 0; characters
 * outside the alphabet are dropped.
 */

export const INVITE_CODE_LENGTH = 8;
const ALPHABET = /^[0-9A-HJKMNP-TV-Z]$/;

export function normalizeInviteCode(input: string): string {
  let out = '';
  for (const ch of input.toUpperCase()) {
    const mapped = ch === 'O' ? '0' : ch === 'I' || ch === 'L' ? '1' : ch;
    if (ALPHABET.test(mapped)) out += mapped;
    if (out.length === INVITE_CODE_LENGTH) break;
  }
  return out;
}

/** `K7PM4QXD` → `K7PM-4QXD`; a partial code gets its hyphen once it has more than 4 characters. */
export function formatInviteCode(code: string): string {
  const c = normalizeInviteCode(code);
  return c.length > 4 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

export function isCompleteInviteCode(code: string): boolean {
  return normalizeInviteCode(code).length === INVITE_CODE_LENGTH;
}

/** Spoken form for VoiceOver: characters separated by spaces. */
export function spellInviteCode(code: string): string {
  return normalizeInviteCode(code).split('').join(' ');
}

/** The code of an invite link: `/join#K7PM-4QXD`, `#k7pm4qxd`, or a full URL. Null when incomplete. */
export function inviteCodeFromHash(hash: string): string | null {
  const fragment = hash.includes('#') ? hash.slice(hash.lastIndexOf('#') + 1) : hash;
  let decoded = fragment;
  try {
    decoded = decodeURIComponent(fragment);
  } catch {
    // keep as is
  }
  const code = normalizeInviteCode(decoded);
  return code.length === INVITE_CODE_LENGTH ? code : null;
}

// ---------------------------------------------------------------------------------------------
// Pending invite, kept across sign-in (sessionStorage: survives the PKCE redirect in this tab)
// ---------------------------------------------------------------------------------------------

const PENDING_KEY = 'cellier:pending-invite';

function session(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function savePendingInvite(code: string): void {
  try {
    session()?.setItem(PENDING_KEY, normalizeInviteCode(code));
  } catch {
    // best effort
  }
}

export function readPendingInvite(): string | null {
  try {
    const value = session()?.getItem(PENDING_KEY);
    return value && isCompleteInviteCode(value) ? value : null;
  } catch {
    return null;
  }
}

export function clearPendingInvite(): void {
  try {
    session()?.removeItem(PENDING_KEY);
  } catch {
    // best effort
  }
}
