import { describe, expect, it } from 'vitest';
import { computeCheckDigit, expandUpcE, isValidGtin, isVariableMeasure, parseBarcode, toGtin14 } from './gtin';

// Products sold in French supermarkets (GS1 France prefix 30–37, plus imports).
const FRENCH_SHELF = [
  '3017620422003', // Nutella
  '7622210449283', // LU Prince
  '5449000000996', // Coca-Cola 33 cl
  '3274080005003', // Cristaline
  '3046920022651',
  '3228857000166',
  '3175680011480',
  '3019081236250',
  '3229820129488',
  '3038350013804',
];

describe('computeCheckDigit', () => {
  it('computes the GS1 mod-10 digit', () => {
    expect(computeCheckDigit('400638133393')).toBe(1);
    expect(computeCheckDigit('301762042200')).toBe(3);
    expect(computeCheckDigit('9638507')).toBe(4);
    expect(computeCheckDigit('03600029145')).toBe(2);
  });

  it('returns 0 when the sum is a multiple of 10', () => {
    expect(computeCheckDigit('544900000099')).toBe(6);
    expect(computeCheckDigit('000000000000')).toBe(0);
  });

  it('rejects non-digits', () => {
    expect(() => computeCheckDigit('12a4')).toThrow();
  });
});

describe('isValidGtin', () => {
  it.each(FRENCH_SHELF)('accepts %s', (code) => {
    expect(isValidGtin(code)).toBe(true);
  });

  it('accepts EAN-8, UPC-A and GTIN-14', () => {
    expect(isValidGtin('96385074')).toBe(true);
    expect(isValidGtin('73513537')).toBe(true);
    expect(isValidGtin('036000291452')).toBe(true);
    expect(isValidGtin('03017620422003')).toBe(true);
  });

  it('rejects every single-digit misread of a real code', () => {
    const code = '3017620422003';
    for (let i = 0; i < code.length; i++) {
      for (let d = 0; d <= 9; d++) {
        if (String(d) === code[i]) continue;
        const misread = code.slice(0, i) + d + code.slice(i + 1);
        expect(isValidGtin(misread)).toBe(false);
      }
    }
  });

  it('rejects wrong lengths and non-digits', () => {
    expect(isValidGtin('')).toBe(false);
    expect(isValidGtin('1234567')).toBe(false);
    expect(isValidGtin('30176204220033')).toBe(false);
    expect(isValidGtin('301762042200x')).toBe(false);
    expect(isValidGtin('12345678901234567')).toBe(false);
  });
});

describe('expandUpcE', () => {
  it('expands each x6 branch of the GS1 table', () => {
    expect(expandUpcE('01234565')).toBe('012345000065'); // x6 = 5..9
    expect(expandUpcE('04252614')).toBe('042100005264'); // x6 = 0..2
    expect(expandUpcE('01234531')).toBe('012300000451'); // x6 = 3
    expect(expandUpcE('01234543')).toBe('012340000053'); // x6 = 4
  });

  it('accepts 6 and 7 digit forms and computes the check digit', () => {
    expect(expandUpcE('425261')).toBe('042100005264');
    expect(expandUpcE('0425261')).toBe('042100005264');
  });

  it('supports number system 1', () => {
    const upca = expandUpcE('1123456');
    expect(upca).toMatch(/^1\d{11}$/);
    expect(isValidGtin(upca ?? '')).toBe(true);
  });

  it('rejects a wrong check digit, number systems other than 0/1 and bad lengths', () => {
    expect(expandUpcE('04252615')).toBeNull();
    expect(expandUpcE('24252614')).toBeNull();
    expect(expandUpcE('12345')).toBeNull();
    expect(expandUpcE('042526145')).toBeNull();
    expect(expandUpcE('0425a614')).toBeNull();
  });
});

describe('toGtin14', () => {
  it('pads every length to 14 digits', () => {
    expect(toGtin14('3017620422003')).toBe('03017620422003');
    expect(toGtin14('036000291452')).toBe('00036000291452');
    expect(toGtin14('96385074')).toBe('00000096385074');
  });
});

describe('isVariableMeasure', () => {
  it('flags EAN-13 prefixes 02 and 20–29', () => {
    for (const p of ['02', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29']) {
      const body = `${p}1234500150`;
      expect(isVariableMeasure(body + computeCheckDigit(body))).toBe(true);
    }
  });

  it('flags UPC-A number system 2 (random weight)', () => {
    expect(isVariableMeasure('212345001508')).toBe(true);
  });

  it('does not flag GS1 company prefixes or EAN-8', () => {
    expect(isVariableMeasure('3017620422003')).toBe(false);
    expect(isVariableMeasure('0034000470693')).toBe(false);
    expect(isVariableMeasure('036000291452')).toBe(false);
    expect(isVariableMeasure('20267605')).toBe(false);
  });
});

describe('parseBarcode', () => {
  it('parses a French EAN-13 into its canonical key and Open Food Facts code', () => {
    expect(parseBarcode('3017620422003')).toEqual({
      ok: true,
      code: {
        kind: 'product',
        format: 'EAN-13',
        digits: '3017620422003',
        gtin14: '03017620422003',
        offCode: '3017620422003',
      },
    });
  });

  it('ignores spaces and hyphens typed from the printed digits', () => {
    const r = parseBarcode(' 3 017620 422003 ');
    expect(r.ok && r.code.kind === 'product' && r.code.gtin14).toBe('03017620422003');
    expect(parseBarcode('3017620-422003').ok).toBe(true);
  });

  it('gives a UPC-A and its EAN-13 form the same key', () => {
    const upca = parseBarcode('034000470693', 'UPC-A');
    const ean = parseBarcode('0034000470693', 'EAN-13');
    expect(upca.ok && upca.code.kind === 'product' && upca.code.gtin14).toBe('00034000470693');
    expect(ean.ok && ean.code.kind === 'product' && ean.code.gtin14).toBe('00034000470693');
    expect(upca.ok && upca.code.kind === 'product' && upca.code.offCode).toBe('034000470693');
  });

  it('sends EAN-8 unpadded to Open Food Facts', () => {
    const r = parseBarcode('96385074');
    expect(r).toEqual({
      ok: true,
      code: { kind: 'product', format: 'EAN-8', digits: '96385074', gtin14: '00000096385074', offCode: '96385074' },
    });
  });

  it('keeps Lidl-style EAN-8 starting with 2 as a product', () => {
    const r = parseBarcode('20267605', 'EAN-8');
    expect(r.ok && r.code.kind).toBe('product');
  });

  it('expands UPC-E before lookup, so it is never sent as an EAN-8', () => {
    const r = parseBarcode('04252614', 'UPC-E');
    expect(r).toEqual({
      ok: true,
      code: { kind: 'product', format: 'UPC-E', digits: '04252614', gtin14: '00042100005264', offCode: '042100005264' },
    });
  });

  it('accepts a UPC-E already expanded by the decoder', () => {
    const r = parseBarcode('0042100005264', 'UPC-E');
    expect(r.ok && r.code.kind === 'product' && r.code.gtin14).toBe('00042100005264');
    expect(parseBarcode('042100005264', 'UPC-E').ok).toBe(true);
    expect(parseBarcode('3017620422003', 'UPC-E')).toEqual({ ok: false, error: 'upce-number-system' });
  });

  it('routes in-store codes to manual entry without a lookup key', () => {
    const body = '021234500150';
    const code = body + computeCheckDigit(body);
    expect(parseBarcode(code)).toEqual({
      ok: true,
      code: { kind: 'variable-measure', format: 'EAN-13', digits: code },
    });
    const weighed = `2${'71234001234'}`;
    const r = parseBarcode(weighed + computeCheckDigit(weighed));
    expect(r.ok && r.code.kind).toBe('variable-measure');
  });

  it('reports why a code is rejected', () => {
    expect(parseBarcode('')).toEqual({ ok: false, error: 'empty' });
    expect(parseBarcode('30176204220O3')).toEqual({ ok: false, error: 'non-digit' });
    expect(parseBarcode('123456789')).toEqual({ ok: false, error: 'length' });
    expect(parseBarcode('30176204220033')).toEqual({ ok: false, error: 'length' });
    expect(parseBarcode('3017620422004')).toEqual({ ok: false, error: 'check-digit' });
    expect(parseBarcode('3017620422003', 'EAN-8')).toEqual({ ok: false, error: 'length' });
    expect(parseBarcode('24252614', 'UPC-E')).toEqual({ ok: false, error: 'upce-number-system' });
    expect(parseBarcode('04252615', 'UPC-E')).toEqual({ ok: false, error: 'check-digit' });
  });
});
