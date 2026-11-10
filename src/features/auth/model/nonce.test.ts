import { describe, expect, it } from 'vitest';
import { base64url, createNonce, sha256Hex } from './nonce';

describe('nonce', () => {
  it('hashes with SHA-256 as lowercase hex', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('encodes base64url without padding', () => {
    expect(base64url(new Uint8Array([0xfb, 0xff, 0xfe]))).toBe('-__-');
    expect(base64url(new Uint8Array([1]))).toBe('AQ');
  });

  it('gives Google the hash of the raw nonce sent to Supabase', async () => {
    const nonce = await createNonce((b) => b.fill(7));
    expect(nonce.raw).toHaveLength(43);
    expect(nonce.raw).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(nonce.hashed).toBe(await sha256Hex(nonce.raw));
    expect(nonce.hashed).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is random by default', async () => {
    const [a, b] = await Promise.all([createNonce(), createNonce()]);
    expect(a.raw).not.toBe(b.raw);
  });
});
