import { assertEquals } from '@std/assert';
import { computeCheckDigit, expandUpcE, isValidGtin, parseBarcode } from './gtin.ts';
import { offCodeFor, parseRequestGtin } from './request-gtin.ts';

Deno.test('gtin.ts copy: check digit, UPC-E, variable measure', () => {
  assertEquals(computeCheckDigit('301762042200'), 3);
  assertEquals(isValidGtin('03017620422003'), true);
  assertEquals(expandUpcE('04252614'), '042100005264');
  assertEquals(parseBarcode('3017620422004'), { ok: false, error: 'check-digit' });
  const r = parseBarcode('04252614', 'UPC-E');
  assertEquals(r.ok && r.code.kind === 'product' && r.code.gtin14, '00042100005264');
});

Deno.test('offCodeFor follows section 3.3', () => {
  assertEquals(offCodeFor('03017620422003'), '3017620422003');
  assertEquals(offCodeFor('00034000470693'), '0034000470693');
  assertEquals(offCodeFor('00000073513537'), '73513537');
  assertEquals(offCodeFor('00000000123457'), '00123457');
  assertEquals(offCodeFor('13017620422000'), '13017620422000');
});

Deno.test('parseRequestGtin: section 3.2 examples in canonical and raw forms', () => {
  assertEquals(parseRequestGtin('03017620422003'), { ok: true, gtin: '03017620422003', offCode: '3017620422003' });
  assertEquals(parseRequestGtin('3017620422003'), { ok: true, gtin: '03017620422003', offCode: '3017620422003' });
  assertEquals(parseRequestGtin('3017620422004'), { ok: false, code: 'invalid_gtin' });
  assertEquals(parseRequestGtin('034000470693'), { ok: true, gtin: '00034000470693', offCode: '0034000470693' });
  assertEquals(parseRequestGtin('00000073513537'), { ok: true, gtin: '00000073513537', offCode: '73513537' });
  assertEquals(parseRequestGtin('73513537'), { ok: true, gtin: '00000073513537', offCode: '73513537' });
  assertEquals(parseRequestGtin('00042100005264'), { ok: true, gtin: '00042100005264', offCode: '0042100005264' });
  assertEquals(parseRequestGtin('12345'), { ok: false, code: 'invalid_gtin' });
  assertEquals(parseRequestGtin('abc'), { ok: false, code: 'invalid_gtin' });
  assertEquals(parseRequestGtin(''), { ok: false, code: 'invalid_gtin' });
});

Deno.test('parseRequestGtin: restricted circulation (02, 20-29, UPC-A NS 2) in 14-digit form', () => {
  const b1 = '212345600000';
  const c1 = b1 + computeCheckDigit(b1);
  assertEquals(parseRequestGtin(c1), { ok: false, code: 'restricted_gtin' });
  assertEquals(parseRequestGtin(`0${c1}`), { ok: false, code: 'restricted_gtin' });
  const b2 = '021234500000';
  const c2 = b2 + computeCheckDigit(b2);
  assertEquals(parseRequestGtin(`0${c2}`), { ok: false, code: 'restricted_gtin' });
  const b3 = '21234500150';
  assertEquals(parseRequestGtin(`00${b3}${computeCheckDigit(b3)}`), { ok: false, code: 'restricted_gtin' });
});

Deno.test('parseRequestGtin: GTIN-14 with a non-zero indicator', () => {
  const body = '1301762042200';
  const code = body + computeCheckDigit(body);
  assertEquals(parseRequestGtin(code), { ok: true, gtin: code, offCode: code });
  assertEquals(parseRequestGtin(body + ((computeCheckDigit(body) + 1) % 10)), { ok: false, code: 'invalid_gtin' });
});
