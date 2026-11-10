/**
 * Nonce for Google Identity Services → `signInWithIdToken` (research/17 §8.2): Google receives the
 * SHA-256 hex of a random nonce and puts it in the ID token; Supabase receives the raw nonce, hashes
 * it and compares. A replayed ID token therefore fails without the raw value.
 */

export interface Nonce {
  /** Sent to Supabase. 43 base64url characters (32 random bytes). */
  raw: string;
  /** Sent to Google: lowercase hex SHA-256 of `raw`. */
  hashed: string;
}

export function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Hex(input: string, subtle: SubtleCrypto = crypto.subtle): Promise<string> {
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createNonce(
  random: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer> = (b) => crypto.getRandomValues(b),
  subtle?: SubtleCrypto,
): Promise<Nonce> {
  const raw = base64url(random(new Uint8Array(32)));
  return { raw, hashed: await sha256Hex(raw, subtle) };
}
