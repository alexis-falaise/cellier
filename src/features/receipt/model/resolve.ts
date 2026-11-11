/**
 * «Scanner le code-barres» on a receipt line the reader could not match: the barcode goes through the
 * catalogue lookup chain, and the line gets the household product with that barcode — restored if it
 * was deleted, created from the catalogue row, or created with the receipt's readable name when the
 * catalogue does not know it. The product is written at once (a queued mutation), like a scan.
 */
import type { Category, Gtin, MutationArgs, ProductId } from '@/domain/types';
import { catalogueToProductCreate, resolveHouseholdCategory, type ScanOutcome } from '@/features/catalogue';
import { catalogueLookup } from '@/features/scan-flow/model/lookup';
import type { ScannedCode } from '@/shared/lib/gtin';
import { mutate } from '@/shared/sync';

export type BarcodeResolution =
  | { kind: 'product'; productId: ProductId; created: boolean }
  /** In-store or unreadable code: keep scanning. */
  | { kind: 'invalid' };

type CategoryRef = Pick<Category, 'id' | 'templateKey' | 'deletedAt'>;

/** The `product.create` (or nothing) for a lookup outcome. Pure. */
export function createFromOutcome(
  outcome: ScanOutcome,
  ctx: { productId: ProductId; name: string; categories: readonly CategoryRef[]; now: number },
): { existing: ProductId } | { create: MutationArgs['product.create'] } | null {
  switch (outcome.kind) {
    case 'found_household':
      return { existing: outcome.productId };
    case 'found_catalogue':
    case 'found_online':
      return {
        create: catalogueToProductCreate(outcome.product, {
          productId: ctx.productId,
          categories: ctx.categories,
          now: ctx.now,
        }).args,
      };
    case 'not_found': {
      const d = outcome.draft;
      return {
        create: {
          productId: ctx.productId,
          name: ctx.name,
          gtin: outcome.gtin,
          brand: d?.brand ?? null,
          categoryId: resolveHouseholdCategory(ctx.categories, d?.categoryKey ?? null),
          netQuantity: d?.netQuantity ?? null,
          netUnit: d?.netUnit ?? null,
          packCount: d?.packCount ?? null,
          imageUrl: d?.imageUrl ?? null,
        },
      };
    }
    case 'offline':
    case 'lookup_unavailable':
      return {
        create: {
          productId: ctx.productId,
          name: ctx.name,
          gtin: outcome.gtin as Gtin,
          categoryId: resolveHouseholdCategory(ctx.categories, null),
        },
      };
    default:
      return null;
  }
}

export async function resolveBarcode(
  code: ScannedCode,
  ctx: { name: string; categories: readonly CategoryRef[] },
): Promise<BarcodeResolution> {
  if (code.kind !== 'product') return { kind: 'invalid' };
  // The 14-digit key minus its padding zero is a valid EAN-13 for every product format.
  const outcome = await catalogueLookup()
    .lookup(code.gtin14.slice(1))
    .catch((): ScanOutcome => ({ kind: 'lookup_unavailable', gtin: code.gtin14 as Gtin, retryAfter: null }));
  const plan = createFromOutcome(outcome, {
    productId: crypto.randomUUID() as ProductId,
    name: ctx.name,
    categories: ctx.categories,
    now: Date.now(),
  });
  if (!plan) return { kind: 'invalid' };
  if ('existing' in plan) {
    if (outcome.kind === 'found_household' && outcome.restoredFromTombstone) {
      mutate('product.restore', { productId: plan.existing });
    }
    return { kind: 'product', productId: plan.existing, created: false };
  }
  // A create whose barcode already exists locally returns that product (engine natural-key shortcut).
  const productId = mutate('product.create', plan.create) as unknown as ProductId;
  return { kind: 'product', productId, created: true };
}
