/**
 * Server-side validation of the `gtin` in the request body (section 6.3 step 2).
 *
 * gtin.ts is a verbatim copy of src/shared/lib/gtin/gtin.ts and accepts 8, 12 and 13 digits
 * (plus UPC-E). The client sends the canonical 14-digit form, so this wrapper strips the indicator
 * digit 0 and hands the 13-digit form to `parseBarcode`; a GTIN-14 with a non-zero indicator is
 * checked with `isValidGtin` only (it cannot be an in-store code). `offCode` is computed per
 * section 3.3 from the canonical key.
 */
import { isValidGtin, parseBarcode } from './gtin.ts';

export type RequestGtinResult =
  | { ok: true; gtin: string; offCode: string }
  | { ok: false; code: 'invalid_gtin' | 'restricted_gtin' };

/** Section 3.3: strip leading zeros, pad to 8 if 8 or fewer remain, else 13; 14 digits stay 14. */
export function offCodeFor(gtin14: string): string {
  if (gtin14.length === 14 && gtin14.charAt(0) !== '0') return gtin14;
  const stripped = gtin14.replace(/^0+/, '');
  return stripped.length <= 8 ? stripped.padStart(8, '0') : stripped.padStart(13, '0');
}

export function parseRequestGtin(input: string): RequestGtinResult {
  const digits = input.replace(/[\s-]/g, '');
  if (!/^\d+$/.test(digits)) return { ok: false, code: 'invalid_gtin' };

  if (digits.length === 14) {
    if (digits.charAt(0) !== '0') {
      return isValidGtin(digits) ? { ok: true, gtin: digits, offCode: digits } : { ok: false, code: 'invalid_gtin' };
    }
    return fromParse(digits.slice(1));
  }
  return fromParse(digits);
}

function fromParse(digits: string): RequestGtinResult {
  const r = parseBarcode(digits);
  if (!r.ok) return { ok: false, code: 'invalid_gtin' };
  if (r.code.kind === 'variable-measure') return { ok: false, code: 'restricted_gtin' };
  return { ok: true, gtin: r.code.gtin14, offCode: offCodeFor(r.code.gtin14) };
}
