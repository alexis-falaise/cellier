import { assert, assertEquals, assertMatch } from '@std/assert';
import {
  b64urlDecode,
  b64urlEncode,
  buildPushRequest,
  decryptPayload,
  encryptPayload,
  importVapidKeys,
  topicFromTag,
  VapidSigner,
} from './webpush.ts';

async function vapidJwk(): Promise<string> {
  const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  return JSON.stringify(await crypto.subtle.exportKey('jwk', kp.privateKey));
}

/** A browser-side subscription: ECDH key pair + 16-byte auth secret. */
async function uaSubscription() {
  const kp = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const p256dh = b64urlEncode(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)));
  const auth = b64urlEncode(crypto.getRandomValues(new Uint8Array(16)));
  return { kp, p256dh, auth };
}

Deno.test('base64url round trip, accepts padded standard base64', () => {
  const bytes = new Uint8Array([0xfb, 0xff, 0x00, 0x10, 0x3e]);
  const s = b64urlEncode(bytes);
  assertMatch(s, /^[A-Za-z0-9_-]+$/);
  assertEquals(b64urlDecode(s), bytes);
  assertEquals(b64urlDecode(btoa(String.fromCharCode(...bytes))), bytes);
});

Deno.test('topic is 32 base64url characters and stable per tag', async () => {
  const t1 = await topicFromTag('produit-3f6c2b1e-0000-4000-8000-000000000001');
  assertEquals(t1.length, 32);
  assertMatch(t1, /^[A-Za-z0-9_-]{32}$/);
  assertEquals(t1, await topicFromTag('produit-3f6c2b1e-0000-4000-8000-000000000001'));
  assert(t1 !== (await topicFromTag('digest-3f6c2b1e-0000-4000-8000-000000000001')));
});

Deno.test('aes128gcm encryption round trip (RFC 8291)', async () => {
  const ua = await uaSubscription();
  const plaintext = new TextEncoder().encode(JSON.stringify({ web_push: 8030, notification: { title: 'Pâtes : plus que 1' } }));
  const body = await encryptPayload(plaintext, ua.p256dh, ua.auth);
  assertEquals(new DataView(body.buffer).getUint32(16), 4096);
  assertEquals(body[20], 65);
  assertEquals(body.length, 16 + 4 + 1 + 65 + plaintext.length + 1 + 16);
  const out = await decryptPayload(body, ua.kp.privateKey, ua.p256dh, ua.auth);
  assertEquals(new TextDecoder().decode(out), new TextDecoder().decode(plaintext));
});

Deno.test('RFC 8291 §5 test vector', async () => {
  // Appendix A of RFC 8291.
  const plaintext = new TextEncoder().encode('When I grow up, I want to be a watermelon');
  const asPriv = 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw';
  const asPub = 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8';
  const uaPub = 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4';
  const auth = 'BTBZMqHH6r4Tts7J_aSIgg';
  const salt = b64urlDecode('DGv6ra1nlYgDCS1FRnbzlw');
  const pub = b64urlDecode(asPub);
  const priv = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', d: asPriv, x: b64urlEncode(pub.slice(1, 33)), y: b64urlEncode(pub.slice(33)) },
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );
  const pubKey = await crypto.subtle.importKey('raw', pub, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
  const body = await encryptPayload(plaintext, uaPub, auth, { salt, serverKeys: { privateKey: priv, publicKey: pubKey } });
  assertEquals(
    b64urlEncode(body),
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
  );
});

Deno.test('VAPID authorization header verifies with the derived public key', async () => {
  const keys = await importVapidKeys(await vapidJwk());
  const signer = new VapidSigner(keys, 'mailto:test@example.org', () => 1_800_000_000);
  const header = await signer.authorization('https://web.push.apple.com/QGx1c3Q');
  const m = header.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=([A-Za-z0-9_-]+)$/);
  assert(m);
  const [, h, c, sig, k] = m;
  assertEquals(k, keys.publicKey);
  assertEquals(JSON.parse(new TextDecoder().decode(b64urlDecode(h))), { typ: 'JWT', alg: 'ES256' });
  const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(c)));
  assertEquals(claims, { aud: 'https://web.push.apple.com', exp: 1_800_000_000 + 43_200, sub: 'mailto:test@example.org' });
  const pub = await crypto.subtle.importKey('raw', b64urlDecode(k), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    pub,
    b64urlDecode(sig),
    new TextEncoder().encode(`${h}.${c}`),
  );
  assert(ok);
  // Cached per origin.
  assertEquals(await signer.authorization('https://web.push.apple.com/other'), header);
});

Deno.test('push request against a local fake push service', async () => {
  const ua = await uaSubscription();
  const keys = await importVapidKeys(await vapidJwk());
  const signer = new VapidSigner(keys, 'mailto:test@example.org');
  let seen: { headers: Headers; body: Uint8Array } | null = null;
  const server = Deno.serve({ hostname: '127.0.0.1', port: 0, onListen: () => {} }, async (req) => {
    seen = { headers: req.headers, body: new Uint8Array(await req.arrayBuffer()) };
    return new Response(null, { status: 201 });
  });
  try {
    const endpoint = `http://127.0.0.1:${server.addr.port}/push/abc`;
    const payload = new TextEncoder().encode('{"web_push":8030}');
    const topic = await topicFromTag('digest-x');
    const r = await buildPushRequest({ signer, subscription: { endpoint, p256dh: ua.p256dh, auth: ua.auth }, payload, ttl: 14_400, urgency: 'normal', topic });
    const res = await fetch(r.endpoint, { method: 'POST', headers: r.headers, body: r.body as BodyInit });
    assertEquals(res.status, 201);
    assert(seen);
    const s = seen as { headers: Headers; body: Uint8Array };
    assertEquals(s.headers.get('ttl'), '14400');
    assertEquals(s.headers.get('urgency'), 'normal');
    assertEquals(s.headers.get('topic'), topic);
    assertEquals(s.headers.get('content-encoding'), 'aes128gcm');
    assertMatch(s.headers.get('authorization') ?? '', /^vapid t=.+, k=/);
    const out = await decryptPayload(s.body, ua.kp.privateKey, ua.p256dh, ua.auth);
    assertEquals(new TextDecoder().decode(out), '{"web_push":8030}');
  } finally {
    await server.shutdown();
  }
});
