/**
 * Receipt review (pure). The reader's lines become review lines: each one gets the household product
 * it is (a label the household already matched wins over the model's guess), the cellier it goes to
 * (where the product is kept, else where it was last put, else the default) and whether it is put
 * away. Then `planReceipt` turns the reviewed lines into the mutations to write: one priced
 * `stock.add` per line, the product's price set to the price paid, and its open Courses entry closed.
 */
import type { GroceryEntry, MutationArgs, PantryId, Product, ProductId, StockRow } from '@/domain/types';
import { labelKey } from '@/features/prices';

/** Shape returned by the `scan-receipt` Edge Function. */
export interface ReceiptLineDto {
  label: string;
  name: string;
  quantity: number;
  unitPriceCents: number | null;
  totalCents: number | null;
  productId: string | null;
  skip: boolean;
}

export interface ReceiptDto {
  store: string | null;
  purchasedOn: string | null;
  totalCents: number | null;
  lines: ReceiptLineDto[];
}

/** How the line's product was found. */
export type MatchSource = 'memory' | 'model' | 'scan' | null;

export interface ReviewLine {
  key: string;
  label: string;
  /** Readable name from the reader (also the name of a product created by scanning). */
  name: string;
  quantity: number;
  unitPriceCents: number | null;
  productId: ProductId | null;
  match: MatchSource;
  pantryId: PantryId | null;
  /** Put away when confirmed. Lines without a product are never written. */
  included: boolean;
}

export interface ReviewContext {
  isLiveProduct: (id: string) => boolean;
  /** Receipt label → product already matched by the household. */
  memory: ReadonlyMap<string, ProductId>;
  /** Live pantries in display order. */
  pantryIds: readonly PantryId[];
  stock: Iterable<Pick<StockRow, 'pantryId' | 'productId' | 'quantity'>>;
  /** Restocks newest first, for "where was it last put". */
  restocks: readonly { pantryId: PantryId; productId: ProductId }[];
  /** The cellier used when nothing is known (the selected one, else the first). */
  fallbackPantryId: PantryId | null;
}

/** Cellier for a product: largest stock, else last restock, else the fallback. Live pantries only. */
export function defaultPantryFor(productId: ProductId | null, ctx: ReviewContext): PantryId | null {
  const live = new Set<string>(ctx.pantryIds);
  if (productId) {
    let best: { pantryId: PantryId; quantity: number } | null = null;
    for (const row of ctx.stock) {
      if (row.productId !== productId || row.quantity <= 0 || !live.has(row.pantryId)) continue;
      if (!best || row.quantity > best.quantity) best = { pantryId: row.pantryId, quantity: row.quantity };
    }
    if (best) return best.pantryId;
    const last = ctx.restocks.find((m) => m.productId === productId && live.has(m.pantryId));
    if (last) return last.pantryId;
  }
  if (ctx.fallbackPantryId && live.has(ctx.fallbackPantryId)) return ctx.fallbackPantryId;
  return ctx.pantryIds[0] ?? null;
}

export function buildReview(receipt: ReceiptDto, ctx: ReviewContext): ReviewLine[] {
  return receipt.lines.map((line, index) => {
    const remembered = ctx.memory.get(labelKey(line.label)) ?? null;
    const fromModel = line.productId && ctx.isLiveProduct(line.productId) ? (line.productId as ProductId) : null;
    const productId = remembered ?? fromModel;
    return {
      key: `${index}`,
      label: line.label,
      name: line.name || line.label,
      quantity: Math.min(999, Math.max(1, Math.round(line.quantity) || 1)),
      unitPriceCents: line.unitPriceCents,
      productId,
      match: remembered ? 'memory' : fromModel ? 'model' : null,
      pantryId: defaultPantryFor(productId, ctx),
      included: !line.skip,
    };
  });
}

/** A line that will be written on confirm. */
export const isWritable = (line: ReviewLine): boolean =>
  line.included && line.productId !== null && line.pantryId !== null;

/** Lines still to identify (included, no product). */
export const needsProduct = (line: ReviewLine): boolean => line.included && line.productId === null;

export function writableUnits(lines: readonly ReviewLine[]): number {
  return lines.reduce((n, l) => (isWritable(l) ? n + l.quantity : n), 0);
}

export type PlannedMutation =
  | { name: 'stock.add'; args: MutationArgs['stock.add'] }
  | { name: 'product.update'; args: MutationArgs['product.update'] }
  | { name: 'grocery.delete'; args: MutationArgs['grocery.delete'] };

export interface PlanContext {
  receiptId: string;
  store: string | null;
  product: (id: ProductId) => Pick<Product, 'id' | 'priceCents' | 'priceSource'> | undefined;
  openGroceryEntry: (id: ProductId) => Pick<GroceryEntry, 'id'> | undefined;
}

const clip = (s: string, max: number) => {
  const text = s.trim().replace(/\s+/g, ' ').slice(0, max).trim();
  return text === '' ? null : text;
};

/**
 * Mutations for the confirmed receipt, in order: every restock first (so a failure leaves prices
 * untouched), then one price update per product (the last line's price), then the Courses entries.
 */
export function planReceipt(lines: readonly ReviewLine[], ctx: PlanContext): PlannedMutation[] {
  const restocks: PlannedMutation[] = [];
  const prices = new Map<ProductId, number>();
  const products: ProductId[] = [];
  const store = ctx.store ? clip(ctx.store, 60) : null;
  for (const line of lines) {
    if (!isWritable(line)) continue;
    const productId = line.productId as ProductId;
    restocks.push({
      name: 'stock.add',
      args: {
        pantryId: line.pantryId as PantryId,
        productId,
        quantity: line.quantity,
        source: 'receipt',
        priceCents: line.unitPriceCents,
        receiptId: ctx.receiptId,
        receiptLabel: clip(line.label, 120),
        store,
      },
    });
    if (!products.includes(productId)) products.push(productId);
    if (line.unitPriceCents !== null) prices.set(productId, line.unitPriceCents);
  }
  const updates: PlannedMutation[] = [];
  for (const [productId, priceCents] of prices) {
    const product = ctx.product(productId);
    if (!product || (product.priceCents === priceCents && product.priceSource === 'receipt')) continue;
    updates.push({ name: 'product.update', args: { productId, fields: { priceCents, priceSource: 'receipt' } } });
  }
  const groceries: PlannedMutation[] = [];
  for (const productId of products) {
    const entry = ctx.openGroceryEntry(productId);
    if (entry) groceries.push({ name: 'grocery.delete', args: { groceryId: entry.id } });
  }
  return [...restocks, ...updates, ...groceries];
}
