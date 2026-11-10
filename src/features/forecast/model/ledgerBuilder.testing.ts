/** Test helper: builds a consistent ledger (seq, quantityAfter per pantry). Not used by production code. */
import type { MovementKind, PantryId, Product, ProductId } from '@/domain/types';
import { DAY_MS } from './time';
import type { LedgerMovement } from './types';

/** Monday 5 January 2026, 11:00 in Paris (10:00 UTC). */
export const T0 = Date.UTC(2026, 0, 5, 10);
export const day = (n: number) => T0 + n * DAY_MS;

export const P1 = 'pantry-1' as PantryId;
export const P2 = 'pantry-2' as PantryId;
export const PRODUCT = 'product-1' as ProductId;

interface Options {
  pantry?: PantryId;
  /** Device time when it differs from the server apply time. */
  clientAt?: number;
  pending?: boolean;
}

export class LedgerBuilder {
  readonly movements: LedgerMovement[] = [];
  private seq = 0;
  private readonly qty = new Map<PantryId, number>();

  constructor(
    readonly productId: ProductId = PRODUCT,
    initial: ReadonlyArray<[PantryId, number]> = [],
  ) {
    for (const [p, q] of initial) this.qty.set(p, q);
  }

  total(): number {
    let sum = 0;
    for (const q of this.qty.values()) sum += q;
    return sum;
  }

  private push(kind: MovementKind, at: number, delta: number, o: Options = {}, revertsId: string | null = null) {
    const pantry = o.pantry ?? P1;
    const before = this.qty.get(pantry) ?? 0;
    const applied = Math.max(delta, -before);
    this.qty.set(pantry, before + applied);
    const id = `m${this.movements.length + 1}`;
    this.movements.push({
      id: id as LedgerMovement['id'],
      seq: o.pending ? null : ++this.seq,
      pantryId: pantry,
      productId: this.productId,
      kind,
      appliedDelta: applied,
      quantityAfter: before + applied,
      revertsId: revertsId as LedgerMovement['revertsId'],
      clientAt: new Date(o.clientAt ?? at).toISOString(),
      createdAt: new Date(at).toISOString(),
    });
    return id;
  }

  restock(at: number, n: number, o?: Options) {
    return this.push('restock', at, n, o);
  }
  consume(at: number, n: number, o?: Options) {
    return this.push('consume', at, -n, o);
  }
  discard(at: number, n: number, o?: Options) {
    return this.push('discard', at, -n, o);
  }
  recount(at: number, counted: number, o?: Options) {
    const before = this.qty.get(o?.pantry ?? P1) ?? 0;
    return this.push('recount', at, counted - before, o);
  }
  transfer(at: number, from: PantryId, to: PantryId, n: number) {
    this.push('transfer_out', at, -n, { pantry: from });
    return this.push('transfer_in', at, n, { pantry: to });
  }
  revert(at: number, movementId: string) {
    const m = this.movements.find((x) => x.id === movementId);
    if (!m) throw new Error(`unknown movement ${movementId}`);
    return this.push('correction', at, -m.appliedDelta, { pantry: m.pantryId }, movementId);
  }
}

export function product(overrides: Partial<Product> = {}): Product {
  return {
    id: PRODUCT,
    householdId: 'h1' as Product['householdId'],
    name: 'Pâtes',
    brand: null,
    gtin: null,
    catalogGtin: null,
    categoryId: null,
    netQuantity: null,
    netUnit: null,
    packCount: null,
    priceCents: null,
    priceSource: null,
    minQuantity: null,
    usualQuantity: null,
    lowAlert: true,
    imageUrl: null,
    createdAt: new Date(T0).toISOString(),
    updatedAt: new Date(T0).toISOString(),
    deletedAt: null,
    ...overrides,
  };
}
