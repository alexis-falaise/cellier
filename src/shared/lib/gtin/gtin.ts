export type GtinFormat = 'EAN-13' | 'EAN-8' | 'UPC-A' | 'UPC-E';

/** A product code that can be looked up (local store, catalogue, Open Food Facts). */
export interface ProductGtin {
  kind: 'product';
  format: GtinFormat;
  /** Digits as read from the symbol (UPC-E: the 8 printed digits). */
  digits: string;
  /** Canonical storage key: 14 digits, zero-padded. */
  gtin14: string;
  /** Digits to send to Open Food Facts, unpadded (UPC-E is sent expanded to UPC-A). */
  offCode: string;
}

/**
 * In-store / variable-measure code (EAN-13 prefix 02 or 20–29, UPC-A number system 2).
 * Never looked up and never stored as a product barcode: it goes to manual entry.
 */
export interface VariableMeasureCode {
  kind: 'variable-measure';
  format: GtinFormat;
  digits: string;
}

export type ScannedCode = ProductGtin | VariableMeasureCode;

export type GtinError = 'empty' | 'non-digit' | 'length' | 'check-digit' | 'upce-number-system';

export type ParseResult = { ok: true; code: ScannedCode } | { ok: false; error: GtinError };

const DIGITS = /^\d+$/;

/** GS1 mod-10 check digit of a body (the digits without the check digit). */
export function computeCheckDigit(body: string): number {
  if (!DIGITS.test(body)) throw new Error('computeCheckDigit: digits only');
  let sum = 0;
  const n = body.length;
  for (let i = 0; i < n; i++) {
    const weight = (n - i) % 2 === 1 ? 3 : 1;
    sum += (body.charCodeAt(i) - 48) * weight;
  }
  return (10 - (sum % 10)) % 10;
}

/** True for an 8, 12, 13 or 14 digit GTIN whose last digit is a valid check digit. */
export function isValidGtin(code: string): boolean {
  if (!DIGITS.test(code)) return false;
  if (code.length !== 8 && code.length !== 12 && code.length !== 13 && code.length !== 14) return false;
  return computeCheckDigit(code.slice(0, -1)) === code.charCodeAt(code.length - 1) - 48;
}

/**
 * Expand a UPC-E to its 12-digit UPC-A.
 * Accepts 8 digits (number system + 6 + check, check verified), 7 digits (number system + 6) or
 * 6 digits (number system 0 assumed). Returns null when the input is not a valid UPC-E.
 */
export function expandUpcE(upce: string): string | null {
  if (!DIGITS.test(upce)) return null;
  let core: string;
  let printedCheck: string | undefined;
  if (upce.length === 6) core = `0${upce}`;
  else if (upce.length === 7) core = upce;
  else if (upce.length === 8) {
    core = upce.slice(0, 7);
    printedCheck = upce.slice(7);
  } else return null;

  const ns = core.charAt(0);
  if (ns !== '0' && ns !== '1') return null;
  const x1 = core.charAt(1);
  const x2 = core.charAt(2);
  const x3 = core.charAt(3);
  const x4 = core.charAt(4);
  const x5 = core.charAt(5);
  const x6 = core.charAt(6);

  let body: string;
  if (x6 === '0' || x6 === '1' || x6 === '2') body = `${x1}${x2}${x6}0000${x3}${x4}${x5}`;
  else if (x6 === '3') body = `${x1}${x2}${x3}00000${x4}${x5}`;
  else if (x6 === '4') body = `${x1}${x2}${x3}${x4}00000${x5}`;
  else body = `${x1}${x2}${x3}${x4}${x5}0000${x6}`;

  const upca11 = ns + body;
  const upca = `${upca11}${computeCheckDigit(upca11)}`;
  if (printedCheck !== undefined && printedCheck !== upca.slice(-1)) return null;
  return upca;
}

/** Canonical 14-digit key. Expects a valid 8, 12, 13 or 14 digit GTIN. */
export function toGtin14(gtin: string): string {
  return gtin.padStart(14, '0');
}

/**
 * Restricted-circulation in-store code: EAN-13 prefix 02 or 20–29, which includes UPC-A number system 2
 * once padded. EAN-8 is never flagged: Lidl and others sell nationally stable products under EAN-8 prefixes 0 and 2.
 */
export function isVariableMeasure(gtin: string): boolean {
  if (gtin.length !== 12 && gtin.length !== 13) return false;
  const ean13 = gtin.padStart(13, '0');
  return ean13.startsWith('02') || ean13.charAt(0) === '2';
}

function inferFormat(length: number): GtinFormat | null {
  if (length === 13) return 'EAN-13';
  if (length === 12) return 'UPC-A';
  if (length === 8) return 'EAN-8';
  return null;
}

const LENGTHS: Record<GtinFormat, readonly number[]> = {
  'EAN-13': [13],
  'EAN-8': [8],
  'UPC-A': [12],
  // 12 and 13: already expanded by the decoder (zxing-cpp returns UPC-E as its EAN-13 form).
  'UPC-E': [6, 7, 8, 12, 13],
};

/**
 * Parse a decoded or typed barcode. Spaces and hyphens are ignored.
 * Without `format`, the length decides (8 is read as EAN-8, never UPC-E).
 * A UPC-A decoded as a 13-digit EAN-13 with a leading 0 and its 12-digit form share one `gtin14`.
 */
export function parseBarcode(raw: string, format?: GtinFormat): ParseResult {
  const digits = raw.replace(/[\s-]/g, '');
  if (digits === '') return { ok: false, error: 'empty' };
  if (!DIGITS.test(digits)) return { ok: false, error: 'non-digit' };

  const fmt = format ?? inferFormat(digits.length);
  if (!fmt || !LENGTHS[fmt].includes(digits.length)) return { ok: false, error: 'length' };

  let gtin: string;
  if (fmt === 'UPC-E' && digits.length <= 8) {
    const ns = digits.length === 6 ? '0' : digits.charAt(0);
    if (ns !== '0' && ns !== '1') return { ok: false, error: 'upce-number-system' };
    const upca = expandUpcE(digits);
    if (!upca) return { ok: false, error: 'check-digit' };
    gtin = upca;
  } else {
    if (fmt === 'UPC-E') {
      const ns = digits.length === 13 ? digits.slice(0, 2) : `0${digits.charAt(0)}`;
      if (ns !== '00' && ns !== '01') return { ok: false, error: 'upce-number-system' };
    }
    if (!isValidGtin(digits)) return { ok: false, error: 'check-digit' };
    gtin = digits;
  }

  if (isVariableMeasure(gtin)) return { ok: true, code: { kind: 'variable-measure', format: fmt, digits } };
  return { ok: true, code: { kind: 'product', format: fmt, digits, gtin14: toGtin14(gtin), offCode: gtin } };
}
