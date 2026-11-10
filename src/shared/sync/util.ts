import type { EntityName } from '@/domain/types';
import type { EntityKey } from './contract';

/** Mirrors `private.normalize_name`: trim, unaccent, lower case, collapse whitespace. */
export function normalizeName(input: string): string {
  return input
    .trim()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function entityKey(entity: EntityName, id: string): EntityKey {
  return `${entity}/${id}`;
}

export function splitEntityKey(key: EntityKey): [EntityName, string] {
  const i = key.indexOf('/');
  return [key.slice(0, i) as EntityName, key.slice(i + 1)];
}

/** Every string found in a JSON-like value (used to compute dependencies on earlier creates). */
export function collectStrings(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (typeof value === 'string') out.add(value);
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) collectStrings(v, out);
  return out;
}

/** Deep copy of a JSON-like value with every string found in `aliases` replaced by its canonical id. */
export function rewriteIds<T>(value: T, aliases: Readonly<Record<string, string>>): T {
  if (typeof value === 'string') return (aliases[value] ?? value) as T;
  if (Array.isArray(value)) return value.map((v) => rewriteIds(v, aliases)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = rewriteIds(v, aliases);
    return out as T;
  }
  return value;
}

export function hasOwn<T extends object>(obj: T, key: PropertyKey): boolean {
  return Object.hasOwn(obj, key);
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function isInt(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

/** Length check on the trimmed string, as the database `char_length(btrim(x))` checks. */
export function isText(value: unknown, min: number, max: number): value is string {
  if (typeof value !== 'string') return false;
  const n = value.trim().length;
  return n >= min && n <= max;
}
