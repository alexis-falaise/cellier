/**
 * Activité feed (design 03 §4.3): the household ledger turned into rows («Ajout de 6 articles · Cave»,
 * «Lait · −1», «Pâtes · Cave → Garage (2)»…), then grouped by day. Pure: names come from lookups,
 * and every clock-dependent function takes `now`.
 */
import type { Movement } from '@/domain/types';
import type { MovementView } from '@/entities/movement';
import { formatShortDate, t } from '@/shared/i18n';

/** Movements of one member, same direction and cellier, closer than this, form one session row. */
export const SESSION_GAP_MS = 10 * 60_000;
/** Activité loads this many days at a time. */
export const FEED_PAGE_DAYS = 50;

const DAY_MS = 86_400_000;

export type FeedIcon = 'add' | 'withdraw' | 'move' | 'edit' | 'adjust';

export interface FeedDetail {
  productId: string;
  name: string;
  quantity: number;
}

export interface FeedRow {
  key: string;
  /** Epoch ms of the newest movement of the row. */
  at: number;
  actorId: string | null;
  pending: boolean;
  icon: FeedIcon;
  title: string;
  /** Single-product rows open the item; sessions expand instead. */
  productId: string | null;
  /** Products of a session row, with quantities (null for single rows). */
  details: FeedDetail[] | null;
  movementIds: string[];
}

export interface FeedLookups {
  productName: (productId: string) => string;
  pantryName: (pantryId: string) => string;
}

type Direction = 'add' | 'withdraw';

function direction(m: Movement): Direction | null {
  if (m.kind === 'restock') return 'add';
  if (m.kind === 'consume' || m.kind === 'discard') return 'withdraw';
  return null;
}

const time = (m: Movement) => Date.parse(m.createdAt);

interface Session {
  row: FeedRow;
  source: 'scan' | 'put_away';
  direction: Direction;
  pantryId: string;
  oldestAt: number;
  movements: Movement[];
}

function singleRow(view: MovementView, lookups: FeedLookups, legs: ReadonlyMap<string, Movement[]>): FeedRow {
  const m = view.movement;
  const product = lookups.productName(m.productId);
  const qty = Math.abs(m.appliedDelta);
  const base = {
    key: m.id,
    at: time(m),
    actorId: m.actorId,
    pending: view.pending,
    productId: m.productId as string,
    details: null,
    movementIds: [m.id as string],
  };
  switch (m.kind) {
    case 'restock':
      return { ...base, icon: 'add', title: t('activity.add', { product, qty }) };
    case 'consume':
    case 'discard':
      if (!view.pending && m.appliedDelta !== m.requestedDelta) {
        return {
          ...base,
          icon: 'adjust',
          title: t('activity.clamped', {
            product,
            applied: Math.abs(m.appliedDelta),
            requested: Math.abs(m.requestedDelta),
          }),
        };
      }
      return { ...base, icon: 'withdraw', title: t('activity.withdraw', { product, qty }) };
    case 'recount':
      return {
        ...base,
        icon: 'adjust',
        title: t('activity.recount', { product, from: m.quantityAfter - m.appliedDelta, to: m.quantityAfter }),
      };
    case 'transfer_out':
    case 'transfer_in': {
      const pair = m.transferId ? (legs.get(m.transferId) ?? []) : [];
      const out = pair.find((l) => l.kind === 'transfer_out') ?? (m.kind === 'transfer_out' ? m : undefined);
      const into = pair.find((l) => l.kind === 'transfer_in') ?? (m.kind === 'transfer_in' ? m : undefined);
      return {
        ...base,
        key: m.transferId ?? m.id,
        icon: 'move',
        movementIds: pair.length > 0 ? pair.map((l) => l.id as string) : base.movementIds,
        title: t('activity.move', {
          product,
          from: out ? lookups.pantryName(out.pantryId) : '',
          to: into ? lookups.pantryName(into.pantryId) : '',
          qty: Math.abs((into ?? out ?? m).appliedDelta),
        }),
      };
    }
    default:
      // A correction whose original movement is unknown here: show its effect.
      return m.appliedDelta >= 0
        ? { ...base, icon: 'add', title: t('activity.add', { product, qty }) }
        : { ...base, icon: 'withdraw', title: t('activity.withdraw', { product, qty }) };
  }
}

function sessionTitle(s: Session, lookups: FeedLookups): string {
  const n = s.movements.reduce((sum, m) => sum + Math.abs(m.appliedDelta), 0);
  const pantry = lookups.pantryName(s.pantryId);
  if (s.source === 'put_away') return t('activity.putAway', { n, pantry });
  return s.direction === 'add' ? t('activity.addSession', { n, pantry }) : t('activity.withdrawSession', { n, pantry });
}

function sessionDetails(s: Session, lookups: FeedLookups): FeedDetail[] {
  const byProduct = new Map<string, FeedDetail>();
  for (const m of s.movements) {
    const d = byProduct.get(m.productId);
    if (d) d.quantity += Math.abs(m.appliedDelta);
    else
      byProduct.set(m.productId, {
        productId: m.productId,
        name: lookups.productName(m.productId),
        quantity: Math.abs(m.appliedDelta),
      });
  }
  return [...byProduct.values()];
}

/**
 * Rows of the feed, newest first. Undone movements and their corrections cancel out and are not shown;
 * the two legs of a move are one row; scan and put-away sessions are one row each.
 */
export function buildFeed(movements: readonly MovementView[], lookups: FeedLookups): FeedRow[] {
  const ids = new Set(movements.map((v) => v.movement.id as string));
  const reverted = new Set<string>();
  const legs = new Map<string, Movement[]>();
  for (const { movement: m } of movements) {
    if (m.kind === 'correction' && m.revertsId && ids.has(m.revertsId)) reverted.add(m.revertsId);
    if (m.transferId) {
      const list = legs.get(m.transferId);
      if (list) list.push(m);
      else legs.set(m.transferId, [m]);
    }
  }

  const rows: FeedRow[] = [];
  const sessions: Session[] = [];
  const open = new Map<string, Session>();
  const seenTransfers = new Set<string>();

  for (const view of movements) {
    const m = view.movement;
    if (reverted.has(m.id)) continue;
    if (m.kind === 'correction' && m.revertsId && reverted.has(m.revertsId)) continue;
    if (m.transferId) {
      if (seenTransfers.has(m.transferId)) continue;
      seenTransfers.add(m.transferId);
    }

    const dir = direction(m);
    const source = m.source === 'scan' || m.source === 'put_away' ? m.source : null;
    if (dir && source) {
      const key = `${source}|${dir}|${m.actorId ?? ''}|${m.pantryId}`;
      const at = time(m);
      const current = open.get(key);
      if (current && current.oldestAt - at <= SESSION_GAP_MS) {
        current.movements.push(m);
        current.oldestAt = at;
        current.row.pending ||= view.pending;
        current.row.movementIds.push(m.id);
        continue;
      }
      const session: Session = {
        source,
        direction: dir,
        pantryId: m.pantryId,
        oldestAt: at,
        movements: [m],
        row: {
          key: `session:${m.id}`,
          at,
          actorId: m.actorId,
          pending: view.pending,
          icon: dir === 'add' ? 'add' : 'withdraw',
          title: '',
          productId: null,
          details: null,
          movementIds: [m.id],
        },
      };
      open.set(key, session);
      sessions.push(session);
      rows.push(session.row);
      continue;
    }
    rows.push(singleRow(view, lookups, legs));
  }

  for (const s of sessions) {
    const index = rows.indexOf(s.row);
    if (s.source === 'scan' && s.movements.length === 1) {
      const only = s.movements[0] as Movement;
      rows[index] = singleRow({ movement: only, pending: s.row.pending }, lookups, legs);
      continue;
    }
    s.row.title = sessionTitle(s, lookups);
    s.row.details = sessionDetails(s, lookups);
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------
// Days
// ---------------------------------------------------------------------------------------------

function startOfDay(at: number): number {
  const d = new Date(at);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

const weekdayDayMonthYear = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** Day header (§4.3): «Aujourd’hui», «Hier», «Jeudi 14 nov.», with the year when it is not this year's. */
export function dayLabel(dayStart: number, now: number): string {
  const today = startOfDay(now);
  const days = Math.round((today - dayStart) / DAY_MS);
  if (days === 0) return t('activity.day.today');
  if (days === 1) return t('activity.day.yesterday');
  const date = new Date(dayStart);
  const text =
    date.getFullYear() === new Date(now).getFullYear() ? formatShortDate(date) : weekdayDayMonthYear.format(date);
  return text.charAt(0).toLocaleUpperCase('fr') + text.slice(1);
}

export type FeedItem =
  | { type: 'header'; key: string; label: string }
  | { type: 'row'; key: string; row: FeedRow; first: boolean; last: boolean };

/** Rows of the last `days` local days (today included), and whether older rows exist. */
export function feedWindow(rows: readonly FeedRow[], now: number, days: number): { rows: FeedRow[]; hasMore: boolean } {
  const today = new Date(startOfDay(now));
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1)).getTime();
  const visible = rows.filter((r) => r.at >= from);
  return { rows: visible, hasMore: visible.length < rows.length };
}

/** Flattens rows (newest first) into day headers and rows, marking the first and last row of each day. */
export function groupByDay(rows: readonly FeedRow[], now: number): FeedItem[] {
  const items: FeedItem[] = [];
  let currentDay: number | null = null;
  let lastRow: Extract<FeedItem, { type: 'row' }> | null = null;
  for (const row of rows) {
    const day = startOfDay(row.at);
    const newDay = day !== currentDay;
    if (newDay) {
      if (lastRow) lastRow.last = true;
      currentDay = day;
      items.push({ type: 'header', key: `day:${day}`, label: dayLabel(day, now) });
    }
    lastRow = { type: 'row', key: row.key, row, first: newDay, last: false };
    items.push(lastRow);
  }
  if (lastRow) lastRow.last = true;
  return items;
}
