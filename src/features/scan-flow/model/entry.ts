/**
 * Parsing of the optional fields of the unknown-product sheet: «500 g», «1,5 kg», «75 cl», «2 L», «6»
 * (pieces), and a price in euros («2,49», «2.49 €»). Pure; returns null for an empty field and 'invalid'
 * for something that cannot be read.
 */
import type { NetUnit } from '@/domain/types';

export interface ParsedSize {
  netQuantity: number;
  netUnit: NetUnit;
}

const SIZE_RE = /^(\d+(?:[.,]\d+)?)\s*(kg|g|gr|ml|cl|l|litres?|pi[eè]ces?|pcs?)?\.?$/i;

export function parseSize(input: string): ParsedSize | null | 'invalid' {
  const text = input.trim().replace(/\s+/g, ' ');
  if (text === '') return null;
  const match = SIZE_RE.exec(text);
  if (!match) return 'invalid';
  const value = Number((match[1] as string).replace(',', '.'));
  if (!Number.isFinite(value) || value <= 0) return 'invalid';
  const unit = (match[2] ?? '').toLowerCase();
  const round = (n: number) => Math.round(n * 1000) / 1000;
  switch (unit) {
    case 'kg':
      return { netQuantity: round(value * 1000), netUnit: 'g' };
    case 'g':
    case 'gr':
      return { netQuantity: round(value), netUnit: 'g' };
    case 'l':
    case 'litre':
    case 'litres':
      return { netQuantity: round(value * 1000), netUnit: 'ml' };
    case 'cl':
      return { netQuantity: round(value * 10), netUnit: 'ml' };
    case 'ml':
      return { netQuantity: round(value), netUnit: 'ml' };
    default:
      // No unit, or pieces: a count, which must be whole.
      return Number.isInteger(value) ? { netQuantity: value, netUnit: 'piece' } : 'invalid';
  }
}

const PRICE_RE = /^(\d+)(?:[.,](\d{1,2}))?\s*(?:€|eur|euros?)?$/i;

/** Euro cents, or null when empty. */
export function parsePriceCents(input: string): number | null | 'invalid' {
  const text = input.trim();
  if (text === '') return null;
  const match = PRICE_RE.exec(text);
  if (!match) return 'invalid';
  const euros = Number(match[1]);
  const cents = Number(`${match[2] ?? ''}00`.slice(0, 2));
  const total = euros * 100 + cents;
  return Number.isSafeInteger(total) && total <= 1_000_000 ? total : 'invalid';
}

/** Digits typed in the manual entry: a barcode candidate when only digits, spaces and dashes. */
export function looksLikeBarcode(input: string): boolean {
  const compact = input.replace(/[\s-]/g, '');
  return compact.length >= 6 && /^\d+$/.test(compact);
}
