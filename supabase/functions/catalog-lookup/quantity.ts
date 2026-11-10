/** Quantity parsing, section 4.3. Dependency-free. */
import type { NetUnit, QuantityInput, QuantityParse } from './types.ts';

const NUM = String.raw`(\d+(?:\.\d+)?)`;
const INT = String.raw`(\d+)`;
// Longest alternatives first; the look-ahead stands in for \b, which does not know accented letters.
const UNIT = String.raw`(kg|mg|grammes?|gr|g|litres?|liters?|dl|cl|ml|l)(?![\p{L}])`;
const COUNT_NOUN = String.raw`(u|unit[eé]s?|pi[eè]ces?|pcs|rouleaux?|rolls?|sachets?|capsules?|dosettes?|tablettes?|` +
  String.raw`pastilles?|couches?|lingettes?|[œo]e?ufs?|bouteilles?|canettes?|briques?|pots?|bo[iî]tes?|filtres?|` +
  String.raw`[eé]ponges?|sacs?|piles?)(?![\p{L}])`;
const START = String.raw`(?<![\d.])`;

const RE_NESTED = new RegExp(`${START}${INT}\\s*x\\s*${INT}\\s*x\\s*${NUM}\\s*${UNIT}`, 'u');
const RE_MULTI = new RegExp(`${START}${INT}\\s*x\\s*${NUM}\\s*${UNIT}`, 'u');
const RE_MULTI_COUNT = new RegExp(`${START}${INT}\\s*x\\s*${INT}\\s*${COUNT_NOUN}`, 'u');
const RE_SINGLE = new RegExp(`${START}${NUM}\\s*${UNIT}`, 'u');
const RE_COUNT = new RegExp(`${START}${INT}\\s*${COUNT_NOUN}`, 'u');

/** Converts an amount in a label unit to g or ml; null for units that are not converted. */
export function convertUnit(value: number, unit: string): { value: number; unit: NetUnit } | null {
  const u = unit.toLowerCase().trim();
  switch (u) {
    case 'kg':
      return { value: value * 1000, unit: 'g' };
    case 'g':
    case 'gr':
    case 'gramme':
    case 'grammes':
      return { value, unit: 'g' };
    case 'mg':
      return { value: value / 1000, unit: 'g' };
    case 'l':
    case 'litre':
    case 'litres':
    case 'liter':
    case 'liters':
      return { value: value * 1000, unit: 'ml' };
    case 'dl':
      return { value: value * 100, unit: 'ml' };
    case 'cl':
      return { value: value * 10, unit: 'ml' };
    case 'ml':
      return { value, unit: 'ml' };
    default:
      return null;
  }
}

/** Collapses whitespace and cuts to `max` characters on a word boundary; null if empty. */
export function cutAtWord(text: string, max: number): string | null {
  const s = text.replace(/\s+/g, ' ').trim();
  if (s === '') return null;
  if (s.length <= max) return s;
  const head = s.slice(0, max + 1);
  const space = head.lastIndexOf(' ');
  const cut = space > 0 ? s.slice(0, space) : s.slice(0, max);
  return cut.trim() || null;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function parseQuantity(input: QuantityInput): QuantityParse {
  const label = typeof input.quantity === 'string' ? cutAtWord(input.quantity, 60) : null;
  const none: QuantityParse = { quantityLabel: label, netQuantity: null, netUnit: null, packCount: null, method: 'none' };

  const result = parseLabel(typeof input.quantity === 'string' ? input.quantity : '') ??
    parseProductQuantity(input.productQuantity, input.productQuantityUnit);
  if (!result) return none;

  const netQuantity = round3(result.netQuantity);
  if (!(netQuantity >= 0.001 && netQuantity < 1_000_000)) return none;
  if (!Number.isInteger(result.packCount) || result.packCount < 1 || result.packCount > 999) return none;
  return { quantityLabel: label, netQuantity, netUnit: result.netUnit, packCount: result.packCount, method: result.method };
}

interface Parsed {
  netQuantity: number;
  netUnit: NetUnit;
  packCount: number;
  method: Exclude<QuantityParse['method'], 'none'>;
}

function parseLabel(raw: string): Parsed | null {
  if (raw.trim() === '') return null;
  const w = raw
    .toLowerCase()
    .normalize('NFC')
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/℮/g, ' ')
    .replace(/[×*]/g, 'x')
    .replace(/\s+/g, ' ')
    .replace(/(\d\s*[a-z]+)\s+e$/u, '$1') // lone trailing "e" (estimated sign typed as a letter)
    .trim();

  let m = RE_NESTED.exec(w);
  if (m) {
    const c = convertUnit(Number(m[3]), m[4]);
    if (c) return { netQuantity: c.value, netUnit: c.unit, packCount: Number(m[1]) * Number(m[2]), method: 'label_multipack' };
  }
  m = RE_MULTI.exec(w);
  if (m) {
    const c = convertUnit(Number(m[2]), m[3]);
    if (c) return { netQuantity: c.value, netUnit: c.unit, packCount: Number(m[1]), method: 'label_multipack' };
  }
  m = RE_MULTI_COUNT.exec(w);
  if (m) return { netQuantity: 1, netUnit: 'piece', packCount: Number(m[1]) * Number(m[2]), method: 'label_multipack' };

  m = RE_SINGLE.exec(w);
  if (m) {
    const c = convertUnit(Number(m[1]), m[2]);
    if (c) return { netQuantity: c.value, netUnit: c.unit, packCount: 1, method: 'label_single' };
  }
  m = RE_COUNT.exec(w);
  if (m) return { netQuantity: 1, netUnit: 'piece', packCount: Number(m[1]), method: 'label_count' };
  return null;
}

function parseProductQuantity(value: unknown, unit: unknown): Parsed | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isFinite(n) || n <= 0 || typeof unit !== 'string') return null;
  const c = convertUnit(n, unit);
  if (!c) return null;
  return { netQuantity: c.value, netUnit: c.unit, packCount: 1, method: 'product_quantity' };
}
