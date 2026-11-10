import { assertEquals } from '@std/assert';
import { parseQuantity } from './quantity.ts';

type Row = [string | null, number | null, string | null, number | null, string | null, number | null, string];

// Section 4.3 table.
const ROWS: Row[] = [
  ['6 x 1 l', 6000, 'ml', 1000, 'ml', 6, 'label_multipack'],
  ['500 g', 500, 'g', 500, 'g', 1, 'label_single'],
  ['4 x 125 g', 500, 'g', 125, 'g', 4, 'label_multipack'],
  ['75 cl', 750, 'ml', 750, 'ml', 1, 'label_single'],
  ['12 rouleaux', null, null, 1, 'piece', 12, 'label_count'],
  ['12 u', null, null, 1, 'piece', 12, 'label_count'],
  ['240 g (8 x 30 g)', 240, 'g', 30, 'g', 8, 'label_multipack'],
  ['400 g e', 400, 'g', 400, 'g', 1, 'label_single'],
  ['1.89l', 1890, 'ml', 1890, 'ml', 1, 'label_single'],
  ['1,5 L', null, null, 1500, 'ml', 1, 'label_single'],
  ['6 x 33 cl', 1980, 'ml', 330, 'ml', 6, 'label_multipack'],
  ['2 x 6 rouleaux', null, null, 1, 'piece', 12, 'label_multipack'],
  ['30 lavages', null, null, null, null, null, 'none'],
  ['', 1890, 'ml', 1890, 'ml', 1, 'product_quantity'],
];

for (const [quantity, pq, pqu, nq, nu, pc, method] of ROWS) {
  Deno.test(`parseQuantity ${JSON.stringify(quantity)}`, () => {
    const r = parseQuantity({ quantity, productQuantity: pq, productQuantityUnit: pqu });
    assertEquals([r.netQuantity, r.netUnit, r.packCount, r.method], [nq, nu, pc, method]);
  });
}

Deno.test('parseQuantity: label, conversions, sanity', () => {
  assertEquals(parseQuantity({ quantity: '  6   x 1 l ' }).quantityLabel, '6 x 1 l');
  assertEquals(parseQuantity({ quantity: '' }).quantityLabel, null);
  assertEquals(parseQuantity({ quantity: '1 kg' }).netQuantity, 1000);
  assertEquals(parseQuantity({ quantity: '500 mg' }).netQuantity, 0.5);
  assertEquals(parseQuantity({ quantity: '2 x 3 x 50 cl' }).packCount, 6);
  assertEquals(parseQuantity({ quantity: '4 × 125 g' }).packCount, 4);
  assertEquals(parseQuantity({ quantity: '12 œufs' }).packCount, 12);
  assertEquals(parseQuantity({ quantity: '12 oz' }).method, 'none');
  assertEquals(parseQuantity({ quantity: '12 oz', productQuantity: '340', productQuantityUnit: 'g' }).method, 'product_quantity');
  assertEquals(parseQuantity({ quantity: '5000 x 1 g' }).method, 'none');
  const long = 'a'.repeat(30) + ' ' + 'b'.repeat(40);
  assertEquals(parseQuantity({ quantity: long }).quantityLabel, 'a'.repeat(30));
});
