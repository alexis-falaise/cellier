import { assertEquals } from '@std/assert';
import { parseRequest, productsMessage, validateResult } from './prompt.ts';

const image = { mediaType: 'image/jpeg', data: 'QUJD' };

Deno.test('parseRequest accepts a JPEG and keeps well-formed products', () => {
  const req = parseRequest({
    image,
    products: [{ id: 'a', name: 'Lait', brand: '', kind: 'lait demi-écrémé' }, { id: 'b' }, 'x'],
  });
  assertEquals(req?.products, [{ id: 'a', name: 'Lait', brand: null, kind: 'lait demi-écrémé' }]);
});

Deno.test('parseRequest rejects other media types and non-base64 data', () => {
  assertEquals(parseRequest({ image: { mediaType: 'image/gif', data: 'QUJD' } }), null);
  assertEquals(parseRequest({ image: { mediaType: 'image/jpeg', data: 'not base64!' } }), null);
  assertEquals(parseRequest({}), null);
});

Deno.test('productsMessage is sorted by id', () => {
  const msg = productsMessage([
    { id: 'b', name: 'Riz', brand: null, kind: null },
    { id: 'a', name: 'Café', brand: 'Malongo', kind: 'café moulu' },
  ]);
  assertEquals(msg.split('\n').slice(1), ['a | Café (Malongo, type : café moulu)', 'b | Riz']);
});

Deno.test('validateResult drops unknown product ids and derives a unit price from the total', () => {
  const out = validateResult(
    {
      store: ' Carrefour  Market ',
      purchasedOn: '2026-11-10',
      totalCents: 1234,
      lines: [
        { label: 'LAIT DEMI ECR', name: 'Lait demi-écrémé', quantity: 3, unitPriceCents: null, totalCents: 297, productId: 'a', skip: false },
        { label: 'SAC', name: 'Sac', quantity: 1, unitPriceCents: 10, totalCents: 10, productId: 'zzz', skip: true },
        { label: '', name: 'x', quantity: 1 },
      ],
    },
    [{ id: 'a', name: 'Lait', brand: null, kind: null }],
  );
  assertEquals(out.store, 'Carrefour Market');
  assertEquals(out.lines.length, 2);
  assertEquals(out.lines[0]?.unitPriceCents, 99);
  assertEquals(out.lines[0]?.productId, 'a');
  assertEquals(out.lines[1]?.productId, null);
  assertEquals(out.lines[1]?.skip, true);
});

Deno.test('validateResult tolerates garbage', () => {
  assertEquals(validateResult(null, []), { store: null, purchasedOn: null, totalCents: null, lines: [] });
  assertEquals(validateResult({ purchasedOn: '10/11/2026' }, []).purchasedOn, null);
});
