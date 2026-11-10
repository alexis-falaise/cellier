import { describe, expect, it } from 'vitest';
import type { FieldOverwrite, Movement } from '@/domain/types';
import { buildHistory, groupByDay, type HistoryContext } from './history';

const ctx: HistoryContext = {
  pantryName: (id) => ({ a: 'Cave', b: 'Cuisine' })[id] ?? '?',
  memberName: (id) => (id === null ? 'Vous' : 'Léa'),
  fieldLabel: (field) => (field === 'priceCents' ? 'Prix unitaire' : null),
  formatValue: (_field, value) => String(value),
};

let n = 0;
function mv(o: Partial<Movement>): { movement: Movement; pending: boolean } {
  n += 1;
  return {
    movement: {
      id: `m${n}`,
      seq: n,
      householdId: 'h',
      pantryId: 'a' as Movement['pantryId'],
      productId: 'p',
      kind: 'restock',
      counted: null,
      requestedDelta: 1,
      appliedDelta: 1,
      quantityAfter: 1,
      transferId: null,
      revertsId: null,
      actorId: 'u1',
      source: 'stepper',
      clientAt: null,
      createdAt: '2026-11-10T10:00:00.000Z',
      ...o,
    } as Movement,
    pending: false,
  };
}

const strip = (s: string) => s.replace(/[  ]/g, ' ');

describe('buildHistory', () => {
  it('describes adds, withdrawals, recounts and corrections', () => {
    const entries = buildHistory(
      [
        mv({ kind: 'restock', appliedDelta: 2, requestedDelta: 2, createdAt: '2026-11-10T10:04:00Z' }),
        mv({ kind: 'consume', appliedDelta: -1, requestedDelta: -1, createdAt: '2026-11-10T10:03:00Z' }),
        mv({ kind: 'recount', counted: 5, appliedDelta: 2, quantityAfter: 5, createdAt: '2026-11-10T10:02:00Z' }),
        mv({ kind: 'correction', appliedDelta: -2, createdAt: '2026-11-10T10:01:00Z' }),
      ],
      [],
      ctx,
    );
    expect(entries.map((e) => [e.kind, strip(e.title), e.trailing])).toEqual([
      ['add', 'Ajout', '+2'],
      ['withdraw', 'Retrait', '−1'],
      ['recount', 'Recomptage', '3 → 5'],
      ['undo', 'Annulation', '−2'],
    ]);
  });

  it('flags a withdrawal clamped at the shelf', () => {
    const [entry] = buildHistory([mv({ kind: 'consume', requestedDelta: -3, appliedDelta: -1 })], [], ctx);
    expect(entry?.kind).toBe('clamped');
    expect(entry?.trailing).toBe('−1');
    expect(strip(entry?.detail ?? '')).toBe('1 sur 3 demandés');
  });

  it('merges the two legs of a transfer into one row', () => {
    const entries = buildHistory(
      [
        mv({ kind: 'transfer_in', pantryId: 'b' as Movement['pantryId'], appliedDelta: 2, transferId: 't1' }),
        mv({ kind: 'transfer_out', pantryId: 'a' as Movement['pantryId'], appliedDelta: -2, transferId: 't1' }),
      ],
      [],
      ctx,
    );
    expect(entries).toHaveLength(1);
    expect(strip(entries[0]?.title ?? '')).toBe('Déplacement · Cave → Cuisine');
    expect(entries[0]?.trailing).toBe('2');
  });

  it('keeps pending entries on top, then newest first, and adds overwrites of shown fields', () => {
    const pending = { ...mv({ kind: 'restock', createdAt: '2026-11-01T00:00:00Z' }), pending: true };
    const overwrite: FieldOverwrite = {
      id: 'o1',
      householdId: 'h' as FieldOverwrite['householdId'],
      entity: 'product',
      rowId: 'p',
      field: 'priceCents',
      oldValue: 189,
      newValue: 199,
      oldHlc: 'x' as FieldOverwrite['oldHlc'],
      newHlc: 'y' as FieldOverwrite['newHlc'],
      actorId: 'u2' as FieldOverwrite['actorId'],
      createdAt: '2026-11-10T12:00:00Z',
    };
    const hidden = { ...overwrite, id: 'o2', field: 'imageUrl' };
    const entries = buildHistory([mv({ createdAt: '2026-11-10T11:00:00Z' }), pending], [overwrite, hidden], ctx);
    expect(entries.map((e) => e.kind)).toEqual(['add', 'overwritten', 'add']);
    expect(entries[0]?.pending).toBe(true);
    expect(entries[1]?.overwrite).toBe(overwrite);
  });
});

describe('groupByDay', () => {
  it('groups consecutive entries by local day, pending ones today', () => {
    const now = new Date(2026, 10, 10, 18).getTime();
    const entries = buildHistory(
      [
        { ...mv({ createdAt: new Date(2026, 10, 1).toISOString() }), pending: true },
        mv({ createdAt: new Date(2026, 10, 10, 9).toISOString() }),
        mv({ createdAt: new Date(2026, 10, 9, 9).toISOString() }),
        mv({ createdAt: new Date(2026, 10, 9, 8).toISOString() }),
      ],
      [],
      ctx,
    );
    const days = groupByDay(entries, now);
    expect(days.map((d) => d.entries.length)).toEqual([2, 2]);
    expect(days[0]?.day).toBe(new Date(2026, 10, 10).getTime());
  });
});
