/**
 * Item history rows (design 03 §4.6.8): ledger movements and «Modification remplacée» records,
 * newest first, pending ones on top. A transfer (two ledger legs) is one «Déplacement» row.
 * Field edits are not in the local store (the change log keeps no content), so only overwrites of
 * this device's values appear as edits.
 */
import type { FieldOverwrite, Movement } from '@/domain/types';
import { t } from '@/shared/i18n';

export type HistoryKind = 'add' | 'withdraw' | 'clamped' | 'recount' | 'move' | 'undo' | 'overwritten';

export interface HistoryEntry {
  key: string;
  kind: HistoryKind;
  /** Epoch ms used for order and day grouping. */
  at: number;
  title: string;
  /** Second line under the title (clamp detail, overwrite detail). */
  detail: string | null;
  /** «+2», «−1», «3 → 5». */
  trailing: string | null;
  pantryId: string | null;
  actorId: string | null;
  pending: boolean;
  /** «Rétablir» target. */
  overwrite: FieldOverwrite | null;
}

export interface HistoryContext {
  pantryName: (pantryId: string) => string;
  memberName: (userId: string | null) => string;
  /** Label of a product field, or null to hide overwrites of that field. */
  fieldLabel: (field: string) => string | null;
  formatValue: (field: string, value: unknown) => string;
}

const plus = (n: number) => t('history.delta.plus', { n });
const minus = (n: number) => t('history.delta.minus', { n });

function movementEntry(
  m: Movement,
  pending: boolean,
  partner: Movement | undefined,
  ctx: HistoryContext,
): HistoryEntry | null {
  const base = {
    key: `m:${m.id}`,
    at: Date.parse(m.createdAt) || 0,
    detail: null,
    pantryId: m.pantryId as string,
    actorId: m.actorId as string | null,
    pending,
    overwrite: null,
  };
  switch (m.kind) {
    case 'restock':
      return { ...base, kind: 'add', title: t('history.add'), trailing: plus(Math.abs(m.appliedDelta)) };
    case 'consume':
    case 'discard': {
      const requested = Math.abs(m.requestedDelta);
      const applied = Math.abs(m.appliedDelta);
      if (!pending && applied < requested) {
        return {
          ...base,
          kind: 'clamped',
          title: t('history.clamped.title'),
          detail: t('history.clamped.detail', { applied, requested }),
          trailing: minus(applied),
        };
      }
      return {
        ...base,
        kind: 'withdraw',
        title: t('history.withdraw'),
        trailing: minus(pending ? requested : applied),
      };
    }
    case 'recount': {
      const to = m.counted ?? m.quantityAfter;
      const from = m.quantityAfter - m.appliedDelta;
      return {
        ...base,
        kind: 'recount',
        title: t('history.recount'),
        trailing: t('history.recountDelta', { from, to }),
      };
    }
    case 'transfer_out':
    case 'transfer_in': {
      const out = m.kind === 'transfer_out' ? m : partner;
      const into = m.kind === 'transfer_in' ? m : partner;
      return {
        ...base,
        pantryId: null,
        kind: 'move',
        title: t('history.move', {
          from: out ? ctx.pantryName(out.pantryId) : '—',
          to: into ? ctx.pantryName(into.pantryId) : '—',
        }),
        trailing: String(Math.abs(m.appliedDelta || m.requestedDelta)),
      };
    }
    case 'correction':
      return {
        ...base,
        kind: 'undo',
        title: t('history.undo'),
        trailing: m.appliedDelta >= 0 ? plus(m.appliedDelta) : minus(-m.appliedDelta),
      };
  }
}

function overwriteEntry(o: FieldOverwrite, ctx: HistoryContext): HistoryEntry | null {
  const field = ctx.fieldLabel(o.field);
  if (field === null) return null;
  return {
    key: `o:${o.id}`,
    kind: 'overwritten',
    at: Date.parse(o.createdAt) || 0,
    title: t('history.overwritten.title'),
    detail: t('history.overwritten.detail', {
      field,
      yourValue: ctx.formatValue(o.field, o.oldValue),
      theirValue: ctx.formatValue(o.field, o.newValue),
      member: ctx.memberName(o.actorId),
    }),
    trailing: null,
    pantryId: null,
    actorId: o.actorId,
    pending: false,
    overwrite: o,
  };
}

/**
 * Movements (newest first, as `useProductMovements` returns them, with their pending flag) and
 * overwrites merged into history entries, newest first; pending entries stay on top.
 */
export function buildHistory(
  movements: ReadonlyArray<{ movement: Movement; pending: boolean }>,
  overwrites: readonly FieldOverwrite[],
  ctx: HistoryContext,
): HistoryEntry[] {
  const legs = new Map<string, Movement[]>();
  for (const { movement } of movements) {
    if (!movement.transferId) continue;
    const list = legs.get(movement.transferId);
    if (list) list.push(movement);
    else legs.set(movement.transferId, [movement]);
  }
  const entries: HistoryEntry[] = [];
  for (const { movement, pending } of movements) {
    let partner: Movement | undefined;
    if (movement.transferId) {
      const pair = legs.get(movement.transferId) ?? [];
      partner = pair.find((p) => p !== movement);
      // One row per transfer: the out-leg, or the in-leg when the out-leg is unknown.
      if (movement.kind === 'transfer_in' && partner?.kind === 'transfer_out') continue;
    }
    const entry = movementEntry(movement, pending, partner, ctx);
    if (entry) entries.push(entry);
  }
  for (const o of overwrites) {
    const entry = overwriteEntry(o, ctx);
    if (entry) entries.push(entry);
  }
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => Number(b.entry.pending) - Number(a.entry.pending) || b.entry.at - a.entry.at || a.index - b.index)
    .map(({ entry }) => entry);
}

export interface HistoryDay {
  key: string;
  /** Local midnight of the day. */
  day: number;
  entries: HistoryEntry[];
}

function startOfDay(t: number): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Consecutive entries of the same local day (pending entries count as today). */
export function groupByDay(entries: readonly HistoryEntry[], now: number): HistoryDay[] {
  const days: HistoryDay[] = [];
  for (const entry of entries) {
    const day = startOfDay(entry.pending ? now : entry.at);
    const last = days[days.length - 1];
    if (last && last.day === day) last.entries.push(entry);
    else days.push({ key: `d:${day}`, day, entries: [entry] });
  }
  return days;
}
