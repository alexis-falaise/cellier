import { assert, assertEquals } from '@std/assert';
import {
  buildPayload,
  composeDigest,
  composeRunningLow,
  MAX_PAYLOAD_BYTES,
  nameListEt,
  nameListPlus,
  NBSP,
  productName,
  RUNNING_LOW_BODY,
  serializePayload,
  tripOf,
} from './compose.ts';

const H = 'aaaaaaaa-0000-4000-8000-000000000001';
const P = (n: number) => `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, '0')}`;
// 2026-11-10 17:00 UTC = 18:00 Paris.
const NOW = Date.parse('2026-11-10T17:00:00Z');

Deno.test('running low, single product with stock', () => {
  const c = composeRunningLow(H, [{ id: P(1), name: ' Pâtes ', totalQuantity: 1, minQuantity: 2 }]);
  assertEquals(c.title, `Pâtes${NBSP}: plus que 1`);
  assertEquals(c.body, RUNNING_LOW_BODY);
  assertEquals(c.body, 'Seuil d’alerte atteint. Ajout automatique à Courses.');
  assertEquals(c.path, `/items/${P(1)}`);
  assertEquals(c.tag, `produit-${P(1)}`);
  assertEquals(c.ttl, 43_200);
});

Deno.test('running low, single product out of stock', () => {
  const c = composeRunningLow(H, [{ id: P(1), name: 'Huile d’olive', totalQuantity: 0, minQuantity: 1 }]);
  assertEquals(c.title, `Huile d’olive${NBSP}: stock épuisé`);
});

Deno.test('running low, grouped', () => {
  const c = composeRunningLow(H, [
    { id: P(1), name: 'Pâtes', totalQuantity: 1, minQuantity: 2 },
    { id: P(2), name: 'Lait', totalQuantity: 0, minQuantity: 1 },
    { id: P(3), name: 'Café', totalQuantity: 1, minQuantity: 1 },
  ]);
  assertEquals(c.title, '3 articles à racheter');
  assertEquals(c.body, 'Pâtes, Lait et Café');
  assertEquals(c.path, '/groceries');
  assertEquals(c.tag, `courses-${H}`);
  assertEquals(c.productIds.length, 3);
});

Deno.test('name lists', () => {
  assertEquals(nameListEt(['A']), 'A');
  assertEquals(nameListEt(['A', 'B']), 'A et B');
  assertEquals(nameListEt(['A', 'B', 'C', 'D']), 'A, B, C et 1 autre');
  assertEquals(nameListEt(['Pâtes', 'Lait', 'Café', 'Riz', 'Sel']), 'Pâtes, Lait, Café et 2 autres');
  assertEquals(nameListPlus(['Café', 'Riz']), 'Café, Riz');
  assertEquals(nameListPlus(['A', 'B', 'C', 'D']), 'A, B, C +1');
});

Deno.test('product names are cut to 40 characters with an ellipsis', () => {
  const n = productName('x'.repeat(50));
  assertEquals(Array.from(n).length, 40);
  assert(n.endsWith('…'));
  const title = composeRunningLow(H, [{ id: P(1), name: 'y'.repeat(80), totalQuantity: 2, minQuantity: 2 }]).title;
  assert(Array.from(title).length <= 60);
});

Deno.test('trip relative to the Paris date', () => {
  assertEquals(tripOf('2026-11-10', NOW), 'today');
  assertEquals(tripOf('2026-11-08', NOW), 'today');
  assertEquals(tripOf('2026-11-11', NOW), 'tomorrow');
  assertEquals(tripOf('2026-11-12', NOW), null);
  assertEquals(tripOf(null, NOW), null);
  // 23:30 UTC on the 10th is already the 11th in Paris.
  assertEquals(tripOf('2026-11-11', Date.parse('2026-11-10T23:30:00Z')), 'today');
});

const digest = {
  lowProducts: [
    { id: P(1), name: 'Lait', totalQuantity: 1 },
    { id: P(2), name: 'Pâtes', totalQuantity: 0 },
  ],
  runningOutSoon: [
    { id: P(5), name: 'Sel', runOutAt: '2026-11-13T00:00:00Z' },
    { id: P(3), name: 'Café', runOutAt: '2026-11-11T00:00:00Z' },
    { id: P(4), name: 'Riz', runOutAt: '2026-11-12T00:00:00Z' },
    { id: P(6), name: 'Thé', runOutAt: '2026-11-12T12:00:00Z' },
    { id: P(1), name: 'Lait', runOutAt: '2026-11-11T00:00:00Z' }, // already in low
    { id: P(7), name: 'Vieux', runOutAt: '2026-09-01T00:00:00Z' }, // stale (> 30 days ago)
  ],
  nextTripOn: '2026-11-11',
};

Deno.test('digest, trip tomorrow', () => {
  const c = composeDigest(H, digest, NOW);
  assert(c);
  assertEquals(c.title, `Courses demain${NBSP}: 6 articles`);
  assertEquals(c.body, `Sous le seuil${NBSP}: Pâtes, Lait · Bientôt épuisé${NBSP}: Café, Riz, Thé +1`);
  assertEquals(c.path, '/groceries');
  assertEquals(c.tag, `digest-${H}`);
  assertEquals(c.ttl, 14_400);
  assertEquals(c.productIds, [P(2), P(1), P(3), P(4), P(6), P(5)]);
});

Deno.test('digest, trip today and no trip, singular', () => {
  const one = { lowProducts: [{ id: P(1), name: 'Lait', totalQuantity: 1 }], runningOutSoon: [], nextTripOn: '2026-11-10' };
  assertEquals(composeDigest(H, one, NOW)?.title, `Courses${NBSP}: 1 article à racheter`);
  assertEquals(composeDigest(H, one, NOW)?.body, `Sous le seuil${NBSP}: Lait`);
  assertEquals(composeDigest(H, { ...one, nextTripOn: null }, NOW)?.title, '1 article à racheter bientôt');
  const soonOnly = { lowProducts: [], runningOutSoon: [{ id: P(3), name: 'Café', runOutAt: '2026-11-11T00:00:00Z' }], nextTripOn: '2026-12-01' };
  assertEquals(composeDigest(H, soonOnly, NOW)?.body, `Bientôt épuisé${NBSP}: Café`);
});

Deno.test('digest with nothing to report is null (empty_digest), even with a trip tomorrow', () => {
  assertEquals(composeDigest(H, { lowProducts: [], runningOutSoon: [], nextTripOn: '2026-11-11' }, NOW), null);
  const staleOnly = { lowProducts: [], runningOutSoon: [{ id: P(7), name: 'Vieux', runOutAt: '2026-09-01T00:00:00Z' }], nextTripOn: null };
  assertEquals(composeDigest(H, staleOnly, NOW), null);
});

Deno.test('payload shape and size bound', () => {
  const c = composeRunningLow(H, [{ id: P(1), name: 'Pâtes', totalQuantity: 1, minQuantity: 2 }]);
  const p = buildPayload(c, H, [412], 'https://cellier-one.vercel.app/', NOW);
  assertEquals(p.web_push, 8030);
  assertEquals(p.notification.navigate, `https://cellier-one.vercel.app/items/${P(1)}`);
  assertEquals(p.notification.data.path, `/items/${P(1)}`);
  assertEquals(p.notification.data.outboxIds, [412]);
  assertEquals(p.notification.data.sentAt, '2026-11-10T17:00:00.000Z');
  assertEquals(Object.keys(p.notification).sort(), ['body', 'data', 'dir', 'lang', 'navigate', 'silent', 'tag', 'title']);
  assert(!('mutable' in p));

  const big = composeDigest(
    H,
    { lowProducts: Array.from({ length: 120 }, (_, i) => ({ id: P(i), name: `Produit ${i}`, totalQuantity: 0 })), runningOutSoon: [], nextTripOn: null },
    NOW,
  );
  assert(big);
  const bytes = serializePayload(buildPayload(big, H, [1], 'https://cellier-one.vercel.app', NOW));
  assert(bytes.length <= MAX_PAYLOAD_BYTES);
  assertEquals(JSON.parse(new TextDecoder().decode(bytes)).notification.title, '120 articles à racheter bientôt');
});
