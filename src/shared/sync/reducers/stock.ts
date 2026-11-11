/**
 * Stock reducers: the ledger as the server's `movement_before_insert` trigger computes it (02 §3).
 * Withdrawals floor at zero, recounts become `counted − current`, transfers move what left the source.
 * Pending movements are view rows with `seq = Infinity`; they disappear when the base brings the real ones.
 */
import type {
  IsoDateTime,
  Movement,
  MovementId,
  MovementKind,
  MovementSource,
  PantryId,
  ProductId,
  UserId,
} from '@/domain/types';
import { stockKey } from '@/domain/types';
import type { EntityKey } from '../contract';
import { entityKey, isInt, isText, isUuid } from '../util';
import { liveRow } from './descriptive';
import type { ReducerDraft, SyncReducer, ViewReader } from './types';

const SOURCES: readonly MovementSource[] = ['scan', 'swipe', 'stepper', 'put_away', 'form', 'receipt'];

/** Sequence number of a pending (optimistic) movement. */
export const PENDING_SEQ = Number.POSITIVE_INFINITY;

/** Id of the optimistic in-leg of a pending transfer (the server generates the real one). */
export const pendingInLegId = (mutationId: string) => `${mutationId}~in` as MovementId;
/** Id of the optimistic second correction of a pending transfer revert. */
export const pendingSecondCorrectionId = (mutationId: string) => `${mutationId}~2` as MovementId;

function validSource(source: unknown): boolean {
  return source === undefined || source === null || SOURCES.includes(source as MovementSource);
}

function targetValid(view: ReducerDraft, pantryId: string, productId: string): boolean {
  return liveRow(view, 'pantry', pantryId) !== undefined && liveRow(view, 'product', productId) !== undefined;
}

function currentQuantity(view: ViewReader, pantryId: string, productId: string): number {
  return view.get('stock', stockKey(pantryId as PantryId, productId as ProductId))?.quantity ?? 0;
}

interface LedgerInsert {
  id: string;
  pantryId: string;
  productId: string;
  kind: MovementKind;
  requestedDelta: number;
  counted?: number;
  transferId?: string | null;
  revertsId?: string | null;
  source: MovementSource | null;
  clientAt: IsoDateTime;
  purchase?: Purchase;
}

/** Purchase fields of a restock (receipt or priced put-away). */
interface Purchase {
  priceCents: number | null;
  receiptId: string | null;
  receiptLabel: string | null;
  store: string | null;
}

const optional = (value: unknown, ok: (v: unknown) => boolean) => value === undefined || value === null || ok(value);

/** Mirrors the column checks of migration 16 (price 0..100 000 €, label 1..120, store 1..60). */
function validPurchase(args: { priceCents?: unknown; receiptId?: unknown; receiptLabel?: unknown; store?: unknown }) {
  return (
    optional(args.priceCents, (v) => isInt(v, 0, 10_000_000)) &&
    optional(args.receiptId, isUuid) &&
    optional(args.receiptLabel, (v) => isText(v, 1, 120)) &&
    optional(args.store, (v) => isText(v, 1, 60))
  );
}

const trimmed = (v: string | null | undefined) => (v?.trim() ? v.trim() : null);

/** Inserts one ledger row the way the trigger does and updates the stock row. Returns the applied delta. */
function insertMovement(draft: ReducerDraft, m: LedgerInsert): { applied: number; after: number } {
  const current = currentQuantity(draft, m.pantryId, m.productId);
  let requested = m.requestedDelta;
  let applied: number;
  if (m.kind === 'recount') {
    requested = (m.counted ?? 0) - current;
    applied = requested;
  } else if (requested > 0) {
    applied = requested;
  } else {
    applied = Math.max(requested, -current);
  }
  const after = current + applied;
  const key = stockKey(m.pantryId as PantryId, m.productId as ProductId);
  draft.put('stock', key, {
    householdId: draft.householdId,
    pantryId: m.pantryId as PantryId,
    productId: m.productId as ProductId,
    quantity: after,
    updatedAt: m.clientAt,
  });
  const row: Movement = {
    id: m.id as MovementId,
    seq: PENDING_SEQ,
    householdId: draft.householdId,
    pantryId: m.pantryId as PantryId,
    productId: m.productId as ProductId,
    kind: m.kind,
    counted: m.kind === 'recount' ? (m.counted ?? 0) : null,
    requestedDelta: requested,
    appliedDelta: applied,
    quantityAfter: after,
    transferId: m.transferId ?? null,
    revertsId: (m.revertsId ?? null) as MovementId | null,
    actorId: draft.userId as UserId,
    source: m.source,
    clientAt: m.clientAt,
    createdAt: m.clientAt,
    priceCents: m.purchase?.priceCents ?? null,
    receiptId: m.purchase?.receiptId ?? null,
    receiptLabel: m.purchase?.receiptLabel ?? null,
    store: m.purchase?.store ?? null,
  };
  draft.put('movement', m.id, row);
  return { applied, after };
}

const stockTouch = (pantryId: string, productId: string): EntityKey =>
  entityKey('stock', stockKey(pantryId as PantryId, productId as ProductId));

/** A stock mutation reads its pantry and product (gone check) and writes the stock row. */
const targetTouches = (pantryId: string, productId: string): EntityKey[] => [
  stockTouch(pantryId, productId),
  entityKey('pantry', pantryId),
  entityKey('product', productId),
];

export const stockAdd: SyncReducer<'stock.add'> = {
  validate(args, view) {
    if (!isInt(args.quantity, 1, 9999) || !validSource(args.source) || !validPurchase(args)) return 'validation';
    return targetValid(view, args.pantryId, args.productId) ? null : 'not_found';
  },
  touches: (args, ctx) => [
    ...targetTouches(args.pantryId, args.productId),
    ...(ctx ? [entityKey('movement', ctx.mutationId)] : []),
  ],
  apply(draft, env) {
    const a = env.args;
    if (!targetValid(draft, a.pantryId, a.productId)) return; // server: gone
    insertMovement(draft, {
      id: env.id,
      pantryId: a.pantryId,
      productId: a.productId,
      kind: 'restock',
      requestedDelta: a.quantity,
      source: a.source ?? null,
      clientAt: env.clientAt,
      purchase: {
        priceCents: a.priceCents ?? null,
        receiptId: a.receiptId ?? null,
        receiptLabel: trimmed(a.receiptLabel),
        store: trimmed(a.store),
      },
    });
  },
};

export const stockRemove: SyncReducer<'stock.remove'> = {
  validate(args, view) {
    if (!isInt(args.quantity, 1, 9999) || !validSource(args.source)) return 'validation';
    if (args.reason !== 'consume' && args.reason !== 'discard') return 'validation';
    return targetValid(view, args.pantryId, args.productId) ? null : 'not_found';
  },
  touches: (args, ctx) => [
    ...targetTouches(args.pantryId, args.productId),
    ...(ctx ? [entityKey('movement', ctx.mutationId)] : []),
  ],
  apply(draft, env) {
    const a = env.args;
    if (!targetValid(draft, a.pantryId, a.productId)) return;
    insertMovement(draft, {
      id: env.id,
      pantryId: a.pantryId,
      productId: a.productId,
      kind: a.reason,
      requestedDelta: -a.quantity,
      source: a.source ?? null,
      clientAt: env.clientAt,
    });
  },
};

export const stockRecount: SyncReducer<'stock.recount'> = {
  validate(args, view) {
    if (!isInt(args.counted, 0, 99999) || !validSource(args.source)) return 'validation';
    return targetValid(view, args.pantryId, args.productId) ? null : 'not_found';
  },
  touches: (args, ctx) => [
    ...targetTouches(args.pantryId, args.productId),
    ...(ctx ? [entityKey('movement', ctx.mutationId)] : []),
  ],
  apply(draft, env) {
    const a = env.args;
    if (!targetValid(draft, a.pantryId, a.productId)) return;
    insertMovement(draft, {
      id: env.id,
      pantryId: a.pantryId,
      productId: a.productId,
      kind: 'recount',
      requestedDelta: 0,
      counted: a.counted,
      source: a.source ?? null,
      clientAt: env.clientAt,
    });
  },
};

export const stockTransfer: SyncReducer<'stock.transfer'> = {
  validate(args, view) {
    if (!isInt(args.quantity, 1, 9999) || !validSource(args.source)) return 'validation';
    if (args.fromPantryId === args.toPantryId) return 'validation';
    if (!targetValid(view, args.fromPantryId, args.productId)) return 'not_found';
    return targetValid(view, args.toPantryId, args.productId) ? null : 'not_found';
  },
  touches: (args, ctx) => [
    ...targetTouches(args.fromPantryId, args.productId),
    ...targetTouches(args.toPantryId, args.productId),
    ...(ctx ? [entityKey('movement', ctx.mutationId), entityKey('movement', pendingInLegId(ctx.mutationId))] : []),
  ],
  apply(draft, env) {
    const a = env.args;
    if (a.fromPantryId === a.toPantryId) return;
    if (!targetValid(draft, a.fromPantryId, a.productId) || !targetValid(draft, a.toPantryId, a.productId)) return;
    const source = a.source ?? null;
    const out = insertMovement(draft, {
      id: env.id,
      pantryId: a.fromPantryId,
      productId: a.productId,
      kind: 'transfer_out',
      requestedDelta: -a.quantity,
      transferId: env.id,
      source,
      clientAt: env.clientAt,
    });
    if (out.applied !== 0) {
      insertMovement(draft, {
        id: pendingInLegId(env.id),
        pantryId: a.toPantryId,
        productId: a.productId,
        kind: 'transfer_in',
        requestedDelta: -out.applied,
        transferId: env.id,
        source,
        clientAt: env.clientAt,
      });
    }
  },
};

/** Both legs of a transfer, found by transfer id. */
export function transferLegs(view: ViewReader, transferId: string): { out?: Movement; in?: Movement } {
  const legs: { out?: Movement; in?: Movement } = {};
  for (const m of view.values('movement')) {
    if (m.transferId !== transferId) continue;
    if (m.kind === 'transfer_out') legs.out = m;
    else if (m.kind === 'transfer_in') legs.in = m;
  }
  return legs;
}

function isReverted(view: ViewReader, ids: string[]): boolean {
  for (const m of view.values('movement')) if (m.revertsId !== null && ids.includes(m.revertsId)) return true;
  return false;
}

export const stockRevert: SyncReducer<'stock.revert'> = {
  validate(args, view) {
    const target = view.get('movement', args.movementId);
    if (!target) return 'not_found';
    if (target.kind === 'recount' || target.kind === 'correction') return 'not_revertible';
    if (target.transferId === null) {
      if (target.appliedDelta === 0) return 'not_revertible';
      if (isReverted(view, [target.id])) return 'already_reverted';
      return targetValid(view, target.pantryId, target.productId) ? null : 'not_found';
    }
    const legs = transferLegs(view, target.transferId);
    if (!legs.in || !legs.out) return 'not_revertible';
    if (isReverted(view, [legs.in.id, legs.out.id])) return 'already_reverted';
    if (!targetValid(view, legs.in.pantryId, legs.in.productId)) return 'not_found';
    return targetValid(view, legs.out.pantryId, legs.out.productId) ? null : 'not_found';
  },
  touches(args, ctx) {
    if (!ctx) return [];
    const keys: EntityKey[] = [
      entityKey('movement', ctx.mutationId),
      entityKey('movement', pendingSecondCorrectionId(ctx.mutationId)),
    ];
    keys.push(entityKey('movement', args.movementId));
    const target = ctx.get('movement', args.movementId);
    if (!target) return keys;
    if (target.transferId === null) return [...keys, ...targetTouches(target.pantryId, target.productId)];
    const legs = transferLegs(ctx, target.transferId);
    for (const leg of [legs.in, legs.out]) {
      if (leg) keys.push(entityKey('movement', leg.id), ...targetTouches(leg.pantryId, leg.productId));
    }
    return keys;
  },
  apply(draft, env) {
    const target = draft.get('movement', env.args.movementId);
    if (!target || target.kind === 'recount' || target.kind === 'correction') return;
    if (target.transferId === null) {
      if (target.appliedDelta === 0 || isReverted(draft, [target.id])) return;
      if (!targetValid(draft, target.pantryId, target.productId)) return;
      insertMovement(draft, {
        id: env.id,
        pantryId: target.pantryId,
        productId: target.productId,
        kind: 'correction',
        requestedDelta: -target.appliedDelta,
        revertsId: target.id,
        source: 'undo',
        clientAt: env.clientAt,
      });
      return;
    }
    const { in: inLeg, out: outLeg } = transferLegs(draft, target.transferId);
    if (!inLeg || !outLeg || isReverted(draft, [inLeg.id, outLeg.id])) return;
    if (!targetValid(draft, inLeg.pantryId, inLeg.productId) || !targetValid(draft, outLeg.pantryId, outLeg.productId))
      return;
    const first = insertMovement(draft, {
      id: env.id,
      pantryId: inLeg.pantryId,
      productId: inLeg.productId,
      kind: 'correction',
      requestedDelta: -inLeg.appliedDelta,
      revertsId: inLeg.id,
      source: 'undo',
      clientAt: env.clientAt,
    });
    if (first.applied !== 0) {
      insertMovement(draft, {
        id: pendingSecondCorrectionId(env.id),
        pantryId: outLeg.pantryId,
        productId: outLeg.productId,
        kind: 'correction',
        requestedDelta: -first.applied,
        revertsId: outLeg.id,
        source: 'undo',
        clientAt: env.clientAt,
      });
    }
  },
};
