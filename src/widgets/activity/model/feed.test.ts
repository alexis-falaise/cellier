import { describe, expect, it } from 'vitest';
import type { Movement } from '@/domain/types';
import type { MovementView } from '@/entities/movement';
import { NBSP } from '@/shared/i18n';
import { buildFeed, dayLabel, type FeedLookups, feedWindow, groupByDay } from './feed';

const NAMES: Record<string, string> = { milk: 'Lait', pasta: 'Pâtes', coffee: 'Café' };
const PANTRIES: Record<string, string> = { cave: 'Cave', garage: 'Garage' };
const lookups: FeedLookups = {
  productName: (id) => NAMES[id] ?? '?',
  pantryName: (id) => PANTRIES[id] ?? '?',
};

let seq = 1000;
type Loose<T> = { [K in keyof T]?: T[K] extends string | null ? string | null : T[K] };
function mv(over: Loose<Movement> & { id: string; createdAt: string }, pending = false): MovementView {
  seq -= 1;
  const movement = {
    seq: pending ? Number.POSITIVE_INFINITY : seq,
    householdId: 'h',
    pantryId: 'cave',
    productId: 'milk',
    kind: 'restock',
    counted: null,
    requestedDelta: 1,
    appliedDelta: 1,
    quantityAfter: 1,
    transferId: null,
    revertsId: null,
    actorId: 'alice',
    source: 'form',
    clientAt: null,
    ...over,
  } as unknown as Movement;
  return { movement, pending };
}

describe('buildFeed', () => {
  it('turns single movements into rows', () => {
    const rows = buildFeed(
      [
        mv({ id: 'a', createdAt: '2026-11-10T10:00:00Z', kind: 'consume', requestedDelta: -2, appliedDelta: -2 }),
        mv({ id: 'b', createdAt: '2026-11-10T09:00:00Z', productId: 'pasta', appliedDelta: 3, requestedDelta: 3 }),
      ],
      lookups,
    );
    expect(rows.map((r) => [r.title, r.icon])).toEqual([
      ['Lait · −2', 'withdraw'],
      ['Pâtes · +3', 'add'],
    ]);
    expect(rows[0]?.productId).toBe('milk');
  });

  it('reports a clamped withdrawal and a recount', () => {
    const rows = buildFeed(
      [
        mv({ id: 'a', createdAt: '2026-11-10T10:00:00Z', kind: 'consume', requestedDelta: -3, appliedDelta: -1 }),
        mv({ id: 'b', createdAt: '2026-11-10T09:00:00Z', kind: 'recount', appliedDelta: -2, quantityAfter: 4 }),
      ],
      lookups,
    );
    expect(rows.map((r) => r.title)).toEqual([`Lait · retrait ajusté${NBSP}: 1 sur 3`, 'Lait · recompté 6 → 4']);
  });

  it('groups scan sessions by member, direction and cellier within 10 minutes', () => {
    const rows = buildFeed(
      [
        mv({ id: 'a', createdAt: '2026-11-10T10:09:00Z', source: 'scan', productId: 'milk', appliedDelta: 2 }),
        mv({ id: 'b', createdAt: '2026-11-10T10:05:00Z', source: 'scan', productId: 'pasta', appliedDelta: 1 }),
        mv({ id: 'c', createdAt: '2026-11-10T10:01:00Z', source: 'scan', productId: 'milk', appliedDelta: 1 }),
        // Another member at the same time: its own row.
        mv({ id: 'd', createdAt: '2026-11-10T10:02:00Z', source: 'scan', actorId: 'bob', productId: 'coffee' }),
        // Same member, 30 minutes earlier: a new session.
        mv({ id: 'e', createdAt: '2026-11-10T09:30:00Z', source: 'scan', productId: 'coffee' }),
      ],
      lookups,
    );
    expect(rows.map((r) => r.title)).toEqual(['Ajout de 4 articles · Cave', 'Café · +1', 'Café · +1']);
    expect(rows[0]?.details).toEqual([
      { productId: 'milk', name: 'Lait', quantity: 3 },
      { productId: 'pasta', name: 'Pâtes', quantity: 1 },
    ]);
    expect(rows[0]?.movementIds).toEqual(['a', 'b', 'c']);
    expect(rows[0]?.productId).toBeNull();
  });

  it('names put-away sessions, even with one movement', () => {
    const rows = buildFeed([mv({ id: 'a', createdAt: '2026-11-10T10:00:00Z', source: 'put_away' })], lookups);
    expect(rows[0]?.title).toBe('Courses rangées · 1 article · Cave');
  });

  it('shows the two legs of a move as one row', () => {
    const rows = buildFeed(
      [
        mv({
          id: 'in',
          createdAt: '2026-11-10T10:00:00Z',
          kind: 'transfer_in',
          pantryId: 'garage',
          transferId: 't1',
          appliedDelta: 2,
        }),
        mv({ id: 'out', createdAt: '2026-11-10T10:00:00Z', kind: 'transfer_out', transferId: 't1', appliedDelta: -2 }),
      ],
      lookups,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe('Lait · Cave → Garage (2)');
    expect(rows[0]?.icon).toBe('move');
  });

  it('hides undone movements together with their correction', () => {
    const rows = buildFeed(
      [
        mv({ id: 'undo', createdAt: '2026-11-10T10:01:00Z', kind: 'correction', revertsId: 'a', appliedDelta: -1 }),
        mv({ id: 'a', createdAt: '2026-11-10T10:00:00Z' }),
        mv({ id: 'b', createdAt: '2026-11-10T09:00:00Z', productId: 'pasta' }),
      ],
      lookups,
    );
    expect(rows.map((r) => r.title)).toEqual(['Pâtes · +1']);
  });

  it('keeps the pending flag', () => {
    const rows = buildFeed([mv({ id: 'a', createdAt: '2026-11-10T10:00:00Z' }, true)], lookups);
    expect(rows[0]?.pending).toBe(true);
  });
});

describe('days', () => {
  const now = new Date(2026, 10, 10, 15, 0).getTime();
  const at = (d: number, h = 12) => new Date(2026, 10, d, h).getTime();
  const row = (key: string, time: number) => ({
    key,
    at: time,
    actorId: null,
    pending: false,
    icon: 'add' as const,
    title: key,
    productId: null,
    details: null,
    movementIds: [],
  });

  it('labels today, yesterday, then the date', () => {
    expect(dayLabel(new Date(2026, 10, 10).getTime(), now)).toBe('Aujourd’hui');
    expect(dayLabel(new Date(2026, 10, 9).getTime(), now)).toBe('Hier');
    expect(dayLabel(new Date(2026, 10, 5).getTime(), now)).toBe('Jeudi 5 nov.');
    expect(dayLabel(new Date(2025, 10, 5).getTime(), now)).toBe('Mercredi 5 nov. 2025');
  });

  it('groups rows under day headers and marks the ends of each day', () => {
    const items = groupByDay([row('a', at(10, 14)), row('b', at(10, 9)), row('c', at(9)), row('d', at(3))], now);
    expect(
      items.map((i) => (i.type === 'header' ? `# ${i.label}` : `${i.key}${i.first ? '<' : ''}${i.last ? '>' : ''}`)),
    ).toEqual(['# Aujourd’hui', 'a<', 'b>', '# Hier', 'c<>', '# Mardi 3 nov.', 'd<>']);
  });

  it('windows the feed by days', () => {
    const rows = [row('a', at(10)), row('b', at(9)), row('c', at(1))];
    expect(feedWindow(rows, now, 2)).toEqual({ rows: rows.slice(0, 2), hasMore: true });
    expect(feedWindow(rows, now, 50).hasMore).toBe(false);
  });
});
