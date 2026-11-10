/** Test fixtures: deterministic ids, seeded random, row normalisation for view-versus-server checks. */
import type { DeviceId, EntityName, EntityRowMap, HouseholdId, PantryId, UserId } from '@/domain/types';

export const HOUSEHOLD = '11111111-1111-4111-8111-111111111111' as HouseholdId;
export const OTHER_HOUSEHOLD = '22222222-2222-4222-8222-222222222222' as HouseholdId;
export const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as UserId;
export const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' as UserId;
export const PANTRY = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' as PantryId;
export const DEVICE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' as DeviceId;

/** Deterministic UUID v4-shaped ids: `idGen('e')()` → `eeeeeeee-0000-4000-8000-000000000001`. */
export function idGen(prefix: string) {
  let n = 0;
  const p = prefix.repeat(8).slice(0, 8);
  return () => {
    n += 1;
    return `${p}-0000-4000-8000-${String(n).padStart(12, '0')}`;
  };
}

/** mulberry32 */
export function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(random: () => number, list: readonly T[]): T | undefined {
  return list.length === 0 ? undefined : list[Math.floor(random() * list.length)];
}

const TIME_FIELDS = new Set([
  'createdAt',
  'updatedAt',
  'joinedAt',
  'checkedAt',
  'dismissedAt',
  'deletedAt',
  'clientAt',
]);

/** Comparable form of a row: timestamps become presence flags; server-only movement fields dropped. */
export function normalizeRow(entity: EntityName, row: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (entity === 'movement' && (k === 'seq' || k === 'id' || k === 'transferId' || k === 'revertsId')) continue;
    if (TIME_FIELDS.has(k)) {
      if (k === 'deletedAt' || k === 'checkedAt' || k === 'dismissedAt') out[k] = v !== null;
      continue;
    }
    out[k] = v;
  }
  return out;
}

/** Sorted, normalised rows of one entity, for `expect(...).toEqual(...)`. */
export function normalizeRows<E extends EntityName>(entity: E, rows: Iterable<EntityRowMap[E]>): string[] {
  return [...rows].map((r) => JSON.stringify(normalizeRow(entity, r), Object.keys(r).sort())).sort();
}
