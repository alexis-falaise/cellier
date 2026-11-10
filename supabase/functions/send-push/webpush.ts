/**
 * Web Push with Web Crypto only (no Node crypto):
 * - RFC 8291 message encryption, content coding aes128gcm (RFC 8188), single record;
 * - RFC 8292 VAPID authorization (ES256 JWT, `vapid t=…, k=…`);
 * - RFC 8030 headers (TTL, Urgency, Topic).
 */

const enc = new TextEncoder();

// --- base64url --------------------------------------------------------------------------------

export function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Accepts base64url or standard base64, with or without padding. */
export function b64urlDecode(s: string) {
  const std = s.trim().replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  const padded = std + '='.repeat((4 - (std.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function concatBytes(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

// --- VAPID keys -------------------------------------------------------------------------------

export interface VapidKeys {
  /** ECDSA P-256 private key, sign only. */
  privateKey: CryptoKey;
  /** Uncompressed public point (65 bytes, 0x04 || x || y), base64url: the applicationServerKey. */
  publicKey: string;
}

/** Imports the VAPID private JWK (`{kty:'EC', crv:'P-256', x, y, d}`) and derives the public key from x, y. */
export async function importVapidKeys(jwkJson: string): Promise<VapidKeys> {
  const jwk = JSON.parse(jwkJson) as JsonWebKey;
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y || !jwk.d) {
    throw new Error('VAPID_PRIVATE_JWK must be a P-256 EC private JWK with x, y and d');
  }
  const x = b64urlDecode(jwk.x);
  const y = b64urlDecode(jwk.y);
  if (x.length !== 32 || y.length !== 32) throw new Error('VAPID_PRIVATE_JWK has invalid coordinates');
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  return { privateKey, publicKey: b64urlEncode(concatBytes(new Uint8Array([4]), x, y)) };
}

/** `aud` claim: the origin of the push endpoint. */
export function audienceOf(endpoint: string): string {
  return new URL(endpoint).origin;
}

/** ES256 JWT for RFC 8292. Web Crypto ECDSA already yields the raw r||s form JWS needs. */
export async function vapidJwt(
  keys: VapidKeys,
  audience: string,
  subject: string,
  expiresAtSec: number,
): Promise<string> {
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64urlEncode(enc.encode(JSON.stringify({ aud: audience, exp: expiresAtSec, sub: subject })));
  const input = `${header}.${claims}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, enc.encode(input));
  return `${input}.${b64urlEncode(new Uint8Array(sig))}`;
}

/** Caches one JWT per push-service origin; renewed when less than an hour of validity is left. */
export class VapidSigner {
  private cache = new Map<string, { header: string; exp: number }>();
  private keys: VapidKeys;
  private subject: string;
  private nowSec: () => number;

  constructor(keys: VapidKeys, subject: string, nowSec: () => number = () => Math.floor(Date.now() / 1000)) {
    this.keys = keys;
    this.subject = subject;
    this.nowSec = nowSec;
  }

  async authorization(endpoint: string): Promise<string> {
    const aud = audienceOf(endpoint);
    const now = this.nowSec();
    const hit = this.cache.get(aud);
    if (hit && hit.exp - now > 3600) return hit.header;
    const exp = now + 12 * 3600; // RFC 8292: at most 24 h.
    const header = `vapid t=${await vapidJwt(this.keys, aud, this.subject, exp)}, k=${this.keys.publicKey}`;
    this.cache.set(aud, { header, exp });
    return header;
  }
}

// --- RFC 8291 encryption ----------------------------------------------------------------------

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
  const key = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource },
    key,
    bytes * 8,
  );
  return new Uint8Array(bits);
}

export const RECORD_SIZE = 4096;

export interface EncryptOptions {
  /** Test hooks: fixed salt and application-server key pair. */
  salt?: Uint8Array;
  serverKeys?: CryptoKeyPair;
}

/**
 * Encrypts `plaintext` for a subscription (`p256dh`, `auth` as sent by the browser, base64url).
 * Returns the aes128gcm body: salt(16) | rs(4) | idlen(1) | keyid(65) | ciphertext.
 */
export async function encryptPayload(
  plaintext: Uint8Array,
  p256dh: string,
  auth: string,
  opts: EncryptOptions = {},
) {
  const uaPublic = b64urlDecode(p256dh);
  const authSecret = b64urlDecode(auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('invalid p256dh');
  if (authSecret.length !== 16) throw new Error('invalid auth');
  if (plaintext.length + 17 > RECORD_SIZE) throw new Error('payload too large');

  const serverKeys =
    opts.serverKeys ??
    ((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', serverKeys.publicKey));
  const uaKey = await crypto.subtle.importKey(
    'raw',
    uaPublic as BufferSource,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, serverKeys.privateKey, 256),
  );

  const keyInfo = concatBytes(enc.encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  // Single (last) record: plaintext followed by the 0x02 delimiter, no extra padding.
  const padded = concatBytes(plaintext, new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey('raw', cek as BufferSource, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, aesKey, padded as BufferSource),
  );

  const header = new Uint8Array(16 + 4 + 1);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  return concatBytes(header, asPublic, ciphertext);
}

/**
 * Inverse of encryptPayload, for tests (the user agent's side). `uaPrivate` is the ECDH private key
 * whose public point is `p256dh`.
 */
export async function decryptPayload(body: Uint8Array, uaPrivate: CryptoKey, p256dh: string, auth: string) {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const ciphertext = body.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey(
    'raw',
    asPublic as BufferSource,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, uaPrivate, 256));
  const uaPublic = b64urlDecode(p256dh);
  const keyInfo = concatBytes(enc.encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(b64urlDecode(auth), ecdhSecret, keyInfo, 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const aesKey = await crypto.subtle.importKey('raw', cek as BufferSource, 'AES-GCM', false, ['decrypt']);
  const padded = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, aesKey, ciphertext as BufferSource),
  );
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0) end--;
  if (end < 0 || padded[end] !== 2) throw new Error('bad padding delimiter');
  return padded.slice(0, end);
}

// --- RFC 8030 headers -------------------------------------------------------------------------

/** base64url(SHA-256(tag)), first 32 characters: a valid Topic for any tag (§3.5). */
export async function topicFromTag(tag: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(tag)));
  return b64urlEncode(digest).slice(0, 32);
}

export interface PushRequest {
  endpoint: string;
  headers: Record<string, string>;
  body: Uint8Array;
}

export async function buildPushRequest(args: {
  signer: VapidSigner;
  subscription: { endpoint: string; p256dh: string; auth: string };
  payload: Uint8Array;
  ttl: number;
  urgency: 'very-low' | 'low' | 'normal' | 'high';
  topic: string;
}): Promise<PushRequest> {
  const body = await encryptPayload(args.payload, args.subscription.p256dh, args.subscription.auth);
  return {
    endpoint: args.subscription.endpoint,
    headers: {
      Authorization: await args.signer.authorization(args.subscription.endpoint),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(args.ttl),
      Urgency: args.urgency,
      Topic: args.topic,
    },
    body,
  };
}
