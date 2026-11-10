/**
 * In-memory model of the server rules (supabase/migrations/20261110120700_apply_mutations.sql and
 * 20261110120800_pull_changes.sql), written independently of the client reducers so tests can check
 * that the optimistic view predicts the server. Test-only; never imported by app code.
 */
import type {
  AnyMutationEnvelope,
  ApplyMutationsRequest,
  ApplyMutationsResponse,
  Category,
  EntityName,
  EntityRowMap,
  GroceryEntry,
  Household,
  HouseholdId,
  Member,
  Movement,
  MovementId,
  MovementKind,
  MutationResult,
  Pantry,
  PantryId,
  Product,
  ProductId,
  PullDelete,
  PullRequest,
  PullResponse,
  PullUpserts,
  StockRow,
  UserId,
} from '@/domain/types';
import { rowIdOf } from '@/shared/db/cellierDb';
import { normalizeName } from '../util';

type Rows = { [E in EntityName]: Map<string, EntityRowMap[E]> };
type Result = Omit<MutationResult, 'id'>;

const emptyRows = (): Rows => ({
  household: new Map(),
  member: new Map(),
  pantry: new Map(),
  category: new Map(),
  product: new Map(),
  stock: new Map(),
  movement: new Map(),
  grocery: new Map(),
  overwrite: new Map(),
});

interface HouseholdState {
  rows: Rows;
  clocks: Map<string, Record<string, string>>;
  head: number;
  prunedThrough: number;
  log: Array<{ syncId: number; entity: EntityName; id: string }>;
  applied: Map<string, MutationResult>;
  aliases: Map<string, string>;
}

const ok = (data?: MutationResult['data']): Result => (data ? { status: 'applied', data } : { status: 'applied' });
const gone = (code?: 'not_found'): Result => (code ? { status: 'gone', code } : { status: 'gone' });
const invalid = (code: MutationResult['code'] = 'validation', message?: string): Result => ({
  status: 'invalid',
  code,
  ...(message ? { message } : {}),
});

class InvalidError extends Error {}

export interface FakeServerOptions {
  now?: () => number;
}

export class FakeServer {
  private households = new Map<string, HouseholdState>();
  private movementSeq = 0;
  private idCounter = 0;
  readonly now: () => number;
  /** Called after each committed write, like the Realtime nudge. */
  onCommit: ((householdId: HouseholdId, syncId: number) => void) | null = null;

  constructor(options: FakeServerOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  private iso() {
    return new Date(this.now()).toISOString();
  }

  private uuid(): string {
    this.idCounter += 1;
    return `00000000-0000-4000-8000-${String(this.idCounter).padStart(12, '0')}`;
  }

  createHousehold(id: HouseholdId, owner: UserId, name = 'Maison', pantryId?: PantryId): HouseholdState {
    const state: HouseholdState = {
      rows: emptyRows(),
      clocks: new Map(),
      head: 0,
      prunedThrough: 0,
      log: [],
      applied: new Map(),
      aliases: new Map(),
    };
    this.households.set(id, state);
    const at = this.iso();
    this.write(state, 'household', id, { id, name, createdAt: at, updatedAt: at } satisfies Household);
    this.addMember(id, owner, 'owner');
    if (pantryId) {
      this.write(state, 'pantry', pantryId, {
        id: pantryId,
        householdId: id,
        name: 'Cellier',
        icon: null,
        color: null,
        sortOrder: 0,
        createdAt: at,
        updatedAt: at,
        deletedAt: null,
      } satisfies Pantry);
    }
    return state;
  }

  addMember(householdId: HouseholdId, userId: UserId, role: 'owner' | 'member' = 'member') {
    const state = this.state(householdId);
    this.write(state, 'member', userId, {
      householdId,
      userId,
      role,
      displayName: `User ${userId.slice(0, 4)}`,
      avatarUrl: null,
      notifyRunningLow: true,
      notifyDigest: true,
      joinedAt: this.iso(),
    } satisfies Member);
  }

  removeMember(householdId: HouseholdId, userId: UserId) {
    const state = this.state(householdId);
    this.remove(state, 'member', userId);
  }

  /** Simulates the 30-day change-log retention. */
  pruneLog(householdId: HouseholdId, through: number) {
    const state = this.state(householdId);
    state.prunedThrough = through;
    state.log = state.log.filter((e) => e.syncId > through);
  }

  state(householdId: string): HouseholdState {
    const s = this.households.get(householdId);
    if (!s) throw new Error(`no household ${householdId}`);
    return s;
  }

  rows<E extends EntityName>(householdId: string, entity: E): EntityRowMap[E][] {
    return [...this.state(householdId).rows[entity].values()] as EntityRowMap[E][];
  }

  private write<E extends EntityName>(state: HouseholdState, entity: E, id: string, row: EntityRowMap[E]) {
    state.rows[entity].set(id, row);
    state.head += 1;
    state.log.push({ syncId: state.head, entity, id });
  }

  private remove(state: HouseholdState, entity: EntityName, id: string) {
    state.rows[entity].delete(id);
    state.head += 1;
    state.log.push({ syncId: state.head, entity, id });
  }

  private isMember(state: HouseholdState, userId: string) {
    return state.rows.member.has(userId);
  }

  // ---------------------------------------------------------------------------------------------
  // apply_mutations
  // ---------------------------------------------------------------------------------------------

  applyMutations(request: ApplyMutationsRequest, userId: string): ApplyMutationsResponse {
    const state = this.households.get(request.householdId);
    if (!state || !this.isMember(state, userId)) {
      return {
        status: 'not_member',
        serverTime: this.iso(),
        lastSyncId: 0,
        results: request.mutations.map((m) => ({ id: m.id, status: 'forbidden' })),
      };
    }
    const before = state.head;
    const results: MutationResult[] = [];
    for (const m of request.mutations) {
      const stored = state.applied.get(m.id);
      if (stored) {
        results.push({ ...stored, replayed: true });
        continue;
      }
      const snapshot = this.snapshotState(state);
      let result: Result;
      try {
        result = this.dispatch(state, request.householdId, userId, m);
      } catch (error) {
        this.restoreState(state, snapshot);
        result = invalid('validation', error instanceof Error ? error.message : String(error));
      }
      if (result.status === 'invalid' || result.status === 'gone') {
        // Handlers return before writing, but restore anyway (subtransaction semantics).
        if (state.head !== snapshot.head) this.restoreState(state, snapshot);
      }
      const full = { id: m.id, ...result } as MutationResult;
      state.applied.set(m.id, full);
      results.push(full);
    }
    if (state.head !== before) this.onCommit?.(request.householdId, state.head);
    return { status: 'ok', serverTime: this.iso(), lastSyncId: state.head, results };
  }

  private snapshotState(state: HouseholdState) {
    const rows = emptyRows();
    for (const [e, map] of Object.entries(state.rows) as [string, Map<string, unknown>][])
      (rows as Record<string, Map<string, unknown>>)[e] = new Map(map);
    return {
      rows,
      clocks: new Map(state.clocks),
      head: state.head,
      log: [...state.log],
      aliases: new Map(state.aliases),
      movementSeq: this.movementSeq,
    };
  }

  private restoreState(state: HouseholdState, s: ReturnType<FakeServer['snapshotState']>) {
    state.rows = s.rows;
    state.clocks = s.clocks;
    state.head = s.head;
    state.log = s.log;
    state.aliases = s.aliases;
    this.movementSeq = s.movementSeq;
  }

  private resolve(state: HouseholdState, id: string): string {
    return state.aliases.get(id) ?? id;
  }

  private lww(state: HouseholdState, key: string, fields: Record<string, unknown>, hlc: string, allowed: string[]) {
    const clock = state.clocks.get(key) ?? {};
    const winning: Record<string, unknown> = {};
    const rejected: string[] = [];
    for (const [k, v] of Object.entries(fields)) {
      if (!allowed.includes(k)) throw new InvalidError(`unknown field ${k}`);
      if ((clock[k] ?? '') < hlc) winning[k] = v;
      else rejected.push(k);
    }
    return {
      winning,
      rejected,
      commit: () => {
        const next = { ...clock };
        for (const k of Object.keys(winning)) next[k] = hlc;
        state.clocks.set(key, next);
      },
    };
  }

  private dispatch(state: HouseholdState, hid: HouseholdId, userId: string, m: AnyMutationEnvelope): Result {
    try {
      return this.handle(state, hid, userId, m);
    } catch (error) {
      if (error instanceof InvalidError) return invalid('validation', error.message);
      throw error;
    }
  }

  private handle(state: HouseholdState, hid: HouseholdId, userId: string, m: AnyMutationEnvelope): Result {
    const at = this.iso();
    switch (m.name) {
      case 'household.rename': {
        const me = state.rows.member.get(userId);
        if (me?.role !== 'owner') return invalid('not_owner');
        const w = this.lww(state, `household/${hid}`, { name: m.args.name }, m.hlc, ['name']);
        if (w.rejected.length) return ok({ rejectedFields: ['name'] });
        const row = state.rows.household.get(hid) as Household;
        w.commit();
        this.write(state, 'household', hid, { ...row, name: m.args.name.trim(), updatedAt: at });
        return ok({ rejectedFields: [] });
      }
      case 'member.updateSelf': {
        const row = state.rows.member.get(userId) as Member;
        const a = m.args;
        this.write(state, 'member', userId, {
          ...row,
          displayName: a.displayName?.trim() ?? row.displayName,
          notifyRunningLow: a.notifyRunningLow ?? row.notifyRunningLow,
          notifyDigest: a.notifyDigest ?? row.notifyDigest,
        });
        return ok({ rejectedFields: [] });
      }
      case 'pantry.create':
        return this.namedCreate(state, hid, 'pantry', m.args.pantryId, m.args, m.hlc, 0);
      case 'category.create':
        return this.namedCreate(state, hid, 'category', m.args.categoryId, m.args, m.hlc, 100);
      case 'pantry.update':
        return this.namedUpdate(state, 'pantry', m.args.pantryId, { ...m.args.fields }, m.hlc);
      case 'category.update':
        return this.namedUpdate(state, 'category', m.args.categoryId, { ...m.args.fields }, m.hlc);
      case 'pantry.delete':
        return this.setDeleted(state, 'pantry', m.args.pantryId, true);
      case 'pantry.restore':
        return this.setDeleted(state, 'pantry', m.args.pantryId, false);
      case 'category.delete':
        return this.setDeleted(state, 'category', m.args.categoryId, true);
      case 'category.restore':
        return this.setDeleted(state, 'category', m.args.categoryId, false);
      case 'product.delete':
        return this.setDeleted(state, 'product', m.args.productId, true);
      case 'product.restore':
        return this.setDeleted(state, 'product', m.args.productId, false);
      case 'grocery.delete':
        return this.setDeleted(state, 'grocery', m.args.groceryId, true);
      case 'grocery.restore':
        return this.setDeleted(state, 'grocery', m.args.groceryId, false);
      case 'product.create': {
        const a = m.args;
        const id = a.productId;
        const gtin = a.gtin || null;
        const category = a.categoryId ? this.resolve(state, a.categoryId) : null;
        const key = normalizeName(a.name);
        const existing =
          state.rows.product.get(id) ??
          [...state.rows.product.values()].find((p) =>
            gtin ? p.gtin === gtin : p.gtin === null && normalizeName(p.name) === key,
          );
        if (!existing) {
          if (!a.name || a.name.trim().length < 1 || a.name.trim().length > 200) throw new InvalidError('name');
          const row: Product = {
            id,
            householdId: hid,
            name: a.name.trim(),
            brand: a.brand ?? null,
            gtin: gtin as Product['gtin'],
            catalogGtin: a.catalogGtin ?? null,
            categoryId: category as Product['categoryId'],
            netQuantity: a.netQuantity ?? null,
            netUnit: a.netUnit ?? null,
            packCount: a.packCount ?? null,
            priceCents: a.priceCents ?? null,
            priceSource: a.priceSource ?? null,
            minQuantity: a.minQuantity ?? null,
            usualQuantity: a.usualQuantity ?? null,
            lowAlert: a.lowAlert ?? true,
            imageUrl: a.imageUrl ?? null,
            createdAt: at,
            updatedAt: at,
            deletedAt: null,
          };
          const clock: Record<string, string> = {};
          for (const k of Object.keys(a)) if (!['productId', 'gtin', 'catalogGtin'].includes(k)) clock[k] = m.hlc;
          state.clocks.set(`product/${id}`, clock);
          this.write(state, 'product', id, row);
          return ok({ canonicalId: id, merged: false, restored: false });
        }
        const merged = existing.id !== id;
        if (merged) state.aliases.set(id, existing.id);
        const restored = existing.deletedAt !== null;
        this.write(state, 'product', existing.id, {
          ...existing,
          deletedAt: null,
          brand: existing.brand ?? a.brand ?? null,
          catalogGtin: existing.catalogGtin ?? a.catalogGtin ?? null,
          categoryId: existing.categoryId ?? (category as Product['categoryId']),
          netQuantity: existing.netQuantity ?? a.netQuantity ?? null,
          netUnit: existing.netUnit ?? a.netUnit ?? null,
          packCount: existing.packCount ?? a.packCount ?? null,
          priceCents: existing.priceCents ?? a.priceCents ?? null,
          priceSource: existing.priceSource ?? a.priceSource ?? null,
          minQuantity: existing.minQuantity ?? a.minQuantity ?? null,
          usualQuantity: existing.usualQuantity ?? a.usualQuantity ?? null,
          imageUrl: existing.imageUrl ?? a.imageUrl ?? null,
          updatedAt: at,
        });
        return ok({ canonicalId: existing.id, merged, restored });
      }
      case 'product.update': {
        const id = this.resolve(state, m.args.productId);
        const row = state.rows.product.get(id);
        if (!row) return gone('not_found');
        if (row.deletedAt) return gone();
        const w = this.lww(state, `product/${id}`, m.args.fields as Record<string, unknown>, m.hlc, [
          'name',
          'brand',
          'categoryId',
          'netQuantity',
          'netUnit',
          'packCount',
          'priceCents',
          'priceSource',
          'minQuantity',
          'usualQuantity',
          'lowAlert',
          'imageUrl',
        ]);
        const f = w.winning as Record<string, unknown>;
        if (typeof f.name === 'string' && row.gtin === null) {
          const key = normalizeName(f.name);
          const taken = [...state.rows.product.values()].some(
            (p) => p.id !== id && p.gtin === null && normalizeName(p.name) === key,
          );
          if (taken) return invalid('name_taken');
        }
        const next: Product = { ...row, updatedAt: at };
        for (const [k, v] of Object.entries(f)) {
          if (k === 'name') next.name = String(v).trim();
          else if (k === 'categoryId') next.categoryId = (v ? this.resolve(state, String(v)) : null) as never;
          else if (k === 'lowAlert') next.lowAlert = (v as boolean | null) ?? true;
          else (next as unknown as Record<string, unknown>)[k] = v ?? null;
        }
        w.commit();
        this.write(state, 'product', id, next);
        return ok({ rejectedFields: w.rejected });
      }
      case 'stock.add':
      case 'stock.remove':
      case 'stock.recount': {
        const a = m.args as { pantryId: string; productId: string; quantity?: number; counted?: number };
        const pantry = this.resolve(state, a.pantryId);
        const product = this.resolve(state, a.productId);
        const g = this.checkTarget(state, pantry, product);
        if (g) return g;
        let kind: MovementKind;
        let requested: number;
        if (m.name === 'stock.add') {
          kind = 'restock';
          requested = this.int(a.quantity, 1, 9999);
        } else if (m.name === 'stock.remove') {
          kind = m.args.reason;
          requested = -this.int(a.quantity, 1, 9999);
        } else {
          kind = 'recount';
          requested = 0;
          this.int(a.counted, 0, 99999);
        }
        const source = (m.args as { source?: string }).source ?? null;
        const mv = this.ledger(state, hid, userId, {
          id: m.id,
          pantryId: pantry,
          productId: product,
          kind,
          requested,
          counted: a.counted ?? null,
          source,
          clientAt: m.clientAt,
        });
        return {
          status: mv.appliedDelta === mv.requestedDelta ? 'applied' : 'clamped',
          data: {
            movementId: m.id as unknown as MovementId,
            requested: mv.requestedDelta,
            applied: mv.appliedDelta,
            quantityAfter: mv.quantityAfter,
          },
        };
      }
      case 'stock.transfer': {
        const a = m.args;
        const from = this.resolve(state, a.fromPantryId);
        const to = this.resolve(state, a.toPantryId);
        const product = this.resolve(state, a.productId);
        const qty = this.int(a.quantity, 1, 9999);
        if (from === to) return invalid('validation');
        const g = this.checkTarget(state, from, product) ?? this.checkTarget(state, to, product);
        if (g) return g;
        const source = a.source ?? null;
        const out = this.ledger(state, hid, userId, {
          id: m.id,
          pantryId: from,
          productId: product,
          kind: 'transfer_out',
          requested: -qty,
          transferId: m.id,
          source,
          clientAt: m.clientAt,
        });
        let inId: string | null = null;
        let inQty: number | null = null;
        if (out.appliedDelta !== 0) {
          inId = this.uuid();
          inQty = this.ledger(state, hid, userId, {
            id: inId,
            pantryId: to,
            productId: product,
            kind: 'transfer_in',
            requested: -out.appliedDelta,
            transferId: m.id,
            source,
            clientAt: m.clientAt,
          }).quantityAfter;
        }
        return {
          status: -out.appliedDelta === qty ? 'applied' : 'clamped',
          data: {
            movementId: m.id as unknown as MovementId,
            requested: qty,
            applied: -out.appliedDelta,
            quantityAfter: out.quantityAfter,
            inMovementId: inId as MovementId | null,
            toQuantityAfter: inQty,
          },
        };
      }
      case 'stock.revert': {
        const target = state.rows.movement.get(m.args.movementId);
        if (!target) return gone('not_found');
        if (target.kind === 'recount' || target.kind === 'correction') return invalid('not_revertible');
        const reverted = (ids: string[]) =>
          [...state.rows.movement.values()].some((x) => x.revertsId !== null && ids.includes(x.revertsId));
        if (target.transferId === null) {
          if (target.appliedDelta === 0) return invalid('not_revertible');
          if (reverted([target.id])) return invalid('already_reverted');
          const g = this.checkTarget(state, target.pantryId, target.productId);
          if (g) return g;
          const c = this.ledger(state, hid, userId, {
            id: m.id,
            pantryId: target.pantryId,
            productId: target.productId,
            kind: 'correction',
            requested: -target.appliedDelta,
            revertsId: target.id,
            source: 'undo',
            clientAt: m.clientAt,
          });
          return {
            status: c.appliedDelta === c.requestedDelta ? 'applied' : 'clamped',
            data: {
              movementId: m.id as unknown as MovementId,
              requested: c.requestedDelta,
              applied: c.appliedDelta,
              quantityAfter: c.quantityAfter,
              movementIds: [m.id as unknown as MovementId],
            },
          };
        }
        const legs = [...state.rows.movement.values()].filter((x) => x.transferId === target.transferId);
        const outLeg = legs.find((x) => x.kind === 'transfer_out') as Movement;
        const inLeg = legs.find((x) => x.kind === 'transfer_in');
        if (!inLeg) return invalid('not_revertible');
        if (reverted([outLeg.id, inLeg.id])) return invalid('already_reverted');
        const g =
          this.checkTarget(state, inLeg.pantryId, inLeg.productId) ??
          this.checkTarget(state, outLeg.pantryId, outLeg.productId);
        if (g) return g;
        const c1 = this.ledger(state, hid, userId, {
          id: m.id,
          pantryId: inLeg.pantryId,
          productId: inLeg.productId,
          kind: 'correction',
          requested: -inLeg.appliedDelta,
          revertsId: inLeg.id,
          source: 'undo',
          clientAt: m.clientAt,
        });
        const ids = [m.id as unknown as MovementId];
        if (c1.appliedDelta !== 0) {
          const id2 = this.uuid();
          ids.push(id2 as MovementId);
          this.ledger(state, hid, userId, {
            id: id2,
            pantryId: outLeg.pantryId,
            productId: outLeg.productId,
            kind: 'correction',
            requested: -c1.appliedDelta,
            revertsId: outLeg.id,
            source: 'undo',
            clientAt: m.clientAt,
          });
        }
        return {
          status: c1.appliedDelta === c1.requestedDelta ? 'applied' : 'clamped',
          data: {
            movementId: m.id as unknown as MovementId,
            requested: c1.requestedDelta,
            applied: c1.appliedDelta,
            quantityAfter: c1.quantityAfter,
            movementIds: ids,
          },
        };
      }
      case 'grocery.add': {
        const a = m.args;
        const id = a.groceryId;
        let product: string | null = null;
        let label = a.label?.trim() || null;
        if (a.productId) {
          product = this.resolve(state, a.productId);
          label = null;
          const p = state.rows.product.get(product);
          if (!p) return gone('not_found');
          if (p.deletedAt) return gone();
        }
        if ((product === null) === (label === null)) throw new InvalidError('product xor label');
        const existing =
          state.rows.grocery.get(id) ??
          (product
            ? [...state.rows.grocery.values()].find(
                (g) => g.productId === product && !g.checkedAt && !g.dismissedAt && !g.deletedAt,
              )
            : undefined);
        if (!existing) {
          const row: GroceryEntry = {
            id,
            householdId: hid,
            productId: product as ProductId | null,
            label,
            quantity: a.quantity ?? null,
            addedBy: userId as UserId,
            checkedAt: null,
            checkedBy: null,
            dismissedAt: null,
            createdAt: at,
            updatedAt: at,
            deletedAt: null,
          };
          this.write(state, 'grocery', id, row);
          return ok({ canonicalId: id, merged: false, restored: false });
        }
        const merged = existing.id !== id;
        if (merged) state.aliases.set(id, existing.id);
        const quantity = existing.quantity ?? a.quantity ?? null;
        if (quantity !== existing.quantity) {
          this.write(state, 'grocery', existing.id, { ...existing, quantity, updatedAt: at });
        }
        return ok({ canonicalId: existing.id, merged, restored: false });
      }
      case 'grocery.update': {
        const id = this.resolve(state, m.args.groceryId);
        const row = state.rows.grocery.get(id);
        if (!row) return gone('not_found');
        if (row.deletedAt) return gone();
        const w = this.lww(state, `grocery/${id}`, m.args.fields as Record<string, unknown>, m.hlc, [
          'label',
          'quantity',
          'checked',
          'dismissed',
        ]);
        const f = w.winning;
        if ('label' in f && row.productId !== null) return invalid('validation');
        const next: GroceryEntry = { ...row, updatedAt: at };
        if ('label' in f) next.label = String(f.label).trim() || null;
        if ('quantity' in f) next.quantity = (f.quantity as number | null) ?? null;
        if ('checked' in f) {
          next.checkedAt = f.checked ? (row.checkedAt ?? at) : null;
          next.checkedBy = f.checked ? (row.checkedBy ?? (userId as UserId)) : null;
        }
        if ('dismissed' in f) next.dismissedAt = f.dismissed ? (row.dismissedAt ?? at) : null;
        if (next.productId) {
          const open = (g: GroceryEntry) => !g.checkedAt && !g.dismissedAt && !g.deletedAt;
          if (
            open(next) &&
            [...state.rows.grocery.values()].some((g) => g.id !== id && g.productId === next.productId && open(g))
          )
            throw new InvalidError('unique open entry');
        }
        w.commit();
        this.write(state, 'grocery', id, next);
        return ok({ rejectedFields: w.rejected });
      }
    }
  }

  private namedCreate(
    state: HouseholdState,
    hid: HouseholdId,
    entity: 'pantry' | 'category',
    id: string,
    a: { name: string; icon?: string | null; color?: string | null; sortOrder?: number },
    hlc: string,
    defaultSort: number,
  ): Result {
    const at = this.iso();
    const key = normalizeName(a.name);
    const map = state.rows[entity] as Map<string, Pantry | Category>;
    const existing = map.get(id) ?? [...map.values()].find((r) => normalizeName(r.name) === key);
    if (!existing) {
      const n = a.name.trim().length;
      if (n < 1 || n > 60) throw new InvalidError('name');
      const row = {
        id,
        householdId: hid,
        name: a.name.trim(),
        icon: a.icon ?? null,
        color: a.color ?? null,
        sortOrder: a.sortOrder ?? defaultSort,
        createdAt: at,
        updatedAt: at,
        deletedAt: null,
      };
      const clock: Record<string, string> = {};
      for (const k of Object.keys(a)) if (k !== 'pantryId' && k !== 'categoryId') clock[k] = hlc;
      state.clocks.set(`${entity}/${id}`, clock);
      if (entity === 'pantry') this.write(state, 'pantry', id, row as Pantry);
      else this.write(state, 'category', id, { ...row, templateKey: null } as Category);
      return ok({ canonicalId: id, merged: false, restored: false });
    }
    const merged = existing.id !== id;
    if (merged) state.aliases.set(id, existing.id);
    const restored = existing.deletedAt !== null;
    this.write(state, entity, existing.id, {
      ...existing,
      deletedAt: null,
      icon: existing.icon ?? a.icon ?? null,
      color: existing.color ?? a.color ?? null,
      updatedAt: at,
    } as never);
    return ok({ canonicalId: existing.id, merged, restored });
  }

  private namedUpdate(
    state: HouseholdState,
    entity: 'pantry' | 'category',
    rawId: string,
    fields: Record<string, unknown>,
    hlc: string,
  ): Result {
    const id = this.resolve(state, rawId);
    const map = state.rows[entity] as Map<string, Pantry | Category>;
    const row = map.get(id);
    if (!row) return gone('not_found');
    if (row.deletedAt) return gone();
    const w = this.lww(state, `${entity}/${id}`, fields, hlc, ['name', 'icon', 'color', 'sortOrder']);
    const f = w.winning;
    if (typeof f.name === 'string') {
      const key = normalizeName(f.name);
      if ([...map.values()].some((r) => r.id !== id && normalizeName(r.name) === key)) return invalid('name_taken');
    }
    const next = { ...row, updatedAt: this.iso() } as Record<string, unknown>;
    for (const [k, v] of Object.entries(f)) next[k] = k === 'name' ? String(v).trim() : (v ?? null);
    w.commit();
    this.write(state, entity, id, next as never);
    return ok({ rejectedFields: w.rejected });
  }

  private setDeleted(
    state: HouseholdState,
    entity: 'pantry' | 'category' | 'product' | 'grocery',
    rawId: string,
    del: boolean,
  ): Result {
    const id = this.resolve(state, rawId);
    const map = state.rows[entity] as Map<string, { deletedAt: string | null; updatedAt: string }>;
    const row = map.get(id);
    if (!row) return gone('not_found');
    const deletedAt = del ? (row.deletedAt ?? this.iso()) : null;
    if (deletedAt !== row.deletedAt)
      this.write(state, entity, id, { ...row, deletedAt, updatedAt: this.iso() } as never);
    return ok();
  }

  private checkTarget(state: HouseholdState, pantryId: string, productId: string): Result | null {
    const pantry = state.rows.pantry.get(pantryId);
    const product = state.rows.product.get(productId);
    if (!pantry || !product) return gone('not_found');
    if (pantry.deletedAt || product.deletedAt) return gone();
    return null;
  }

  private int(v: unknown, min: number, max: number): number {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new InvalidError('range');
    return v;
  }

  private ledger(
    state: HouseholdState,
    hid: HouseholdId,
    userId: string,
    m: {
      id: string;
      pantryId: string;
      productId: string;
      kind: MovementKind;
      requested: number;
      counted?: number | null;
      transferId?: string;
      revertsId?: string;
      source: string | null;
      clientAt: string;
    },
  ): Movement {
    const key = `${m.pantryId}:${m.productId}`;
    const at = this.iso();
    let stock = state.rows.stock.get(key);
    if (!stock) {
      stock = {
        householdId: hid,
        pantryId: m.pantryId as PantryId,
        productId: m.productId as ProductId,
        quantity: 0,
        updatedAt: at,
      } satisfies StockRow;
      this.write(state, 'stock', key, stock);
    }
    const qty = stock.quantity;
    let requested = m.requested;
    let applied: number;
    if (m.kind === 'recount') {
      requested = (m.counted ?? 0) - qty;
      applied = requested;
    } else if (requested > 0) applied = requested;
    else applied = Math.max(requested, -qty);
    this.movementSeq += 1;
    const mv: Movement = {
      id: m.id as MovementId,
      seq: this.movementSeq,
      householdId: hid,
      pantryId: m.pantryId as PantryId,
      productId: m.productId as ProductId,
      kind: m.kind,
      counted: m.kind === 'recount' ? (m.counted ?? 0) : null,
      requestedDelta: requested,
      appliedDelta: applied,
      quantityAfter: qty + applied,
      transferId: m.transferId ?? null,
      revertsId: (m.revertsId ?? null) as MovementId | null,
      actorId: userId as UserId,
      source: m.source as Movement['source'],
      clientAt: m.clientAt,
      createdAt: at,
    };
    this.write(state, 'movement', mv.id, mv);
    if (applied !== 0) this.write(state, 'stock', key, { ...stock, quantity: qty + applied, updatedAt: at });
    return mv;
  }

  // ---------------------------------------------------------------------------------------------
  // pull_changes
  // ---------------------------------------------------------------------------------------------

  pullChanges(request: PullRequest, userId: string): PullResponse {
    const state = this.households.get(request.householdId);
    const empty: PullUpserts = {
      household: [],
      member: [],
      pantry: [],
      category: [],
      product: [],
      stock: [],
      movement: [],
      grocery: [],
      overwrite: [],
    };
    const base = { serverTime: this.iso(), upserts: empty, deletes: [] as PullDelete[] };
    if (!state || !this.isMember(state, userId)) {
      return { ...base, status: 'not_member', mode: 'delta', toSyncId: 0, headSyncId: 0, hasMore: false };
    }
    const since = request.since;
    if (since === 0) {
      const upserts = { ...empty } as Record<EntityName, unknown[]>;
      for (const [entity, map] of Object.entries(state.rows)) upserts[entity as EntityName] = [...map.values()];
      return {
        ...base,
        status: 'ok',
        mode: 'snapshot',
        toSyncId: state.head,
        headSyncId: state.head,
        hasMore: false,
        upserts: upserts as unknown as PullUpserts,
      };
    }
    if (since < state.prunedThrough || since > state.head) {
      return { ...base, status: 'resync_required', mode: 'delta', toSyncId: 0, headSyncId: state.head, hasMore: false };
    }
    const limit = Math.min(1000, Math.max(1, request.limit ?? 500));
    const page = state.log.filter((e) => e.syncId > since).slice(0, limit);
    const toSyncId = page.length > 0 ? (page[page.length - 1]?.syncId ?? since) : since;
    const upserts = {
      household: [],
      member: [],
      pantry: [],
      category: [],
      product: [],
      stock: [],
      movement: [],
      grocery: [],
      overwrite: [],
    } as Record<EntityName, unknown[]>;
    const deletes: PullDelete[] = [];
    const seen = new Set<string>();
    for (const e of page) {
      const k = `${e.entity}/${e.id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const row = state.rows[e.entity].get(e.id);
      if (row) upserts[e.entity].push(row);
      else deletes.push({ entity: e.entity as PullDelete['entity'], id: e.id });
    }
    return {
      ...base,
      status: 'ok',
      mode: 'delta',
      toSyncId,
      headSyncId: state.head,
      hasMore: toSyncId < state.head,
      upserts: upserts as unknown as PullUpserts,
      deletes,
    };
  }
}

export { rowIdOf };
