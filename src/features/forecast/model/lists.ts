import type { GroceryEntry, GroceryId, ProductId, UserId } from '@/domain/types';
import { compareFr } from '@/shared/i18n';
import { DAY_MS } from './time';
import type {
  Dismissal,
  DismissalScope,
  EpochMs,
  ForecastConfidence,
  NextTrip,
  ProductForecast,
  RunningLowEntry,
  RunOutBand,
  ShoppingList,
  ShoppingListEntry,
  ShoppingReason,
} from './types';

/** §5.12. True while the product has not been restocked since the dismissal. */
export function isDismissalActive(d: Dismissal, forecast: ProductForecast): boolean {
  if (forecast.lastRestockAt === null) return true;
  return d.restockAtDismissal !== null && forecast.lastRestockAt <= d.restockAtDismissal;
}

function dismissedIds(
  forecasts: readonly ProductForecast[],
  dismissals: readonly Dismissal[],
  scope: DismissalScope,
): Set<ProductId> {
  const byId = new Map(forecasts.map((f) => [f.productId, f]));
  const out = new Set<ProductId>();
  for (const d of dismissals) {
    const f = byId.get(d.productId);
    if (d.scope === scope && f && isDismissalActive(d, f)) out.add(d.productId);
  }
  return out;
}

/** §5.11. Quantity to buy: max(1, ceil((usual ?? clear level) − total)). */
export function suggestedQuantity(f: Pick<ProductForecast, 'usualQuantity' | 'clearLevel' | 'totalQuantity'>): number {
  const target = f.usualQuantity ?? f.clearLevel;
  return Math.max(1, Math.ceil(target - f.totalQuantity));
}

/** §5.10. Accueil «Bientôt épuisé»: running-low products without an active 'home' dismissal, most urgent first. */
export function runningLowView(
  forecasts: readonly ProductForecast[],
  names: ReadonlyMap<ProductId, string>,
  dismissals: readonly Dismissal[],
): RunningLowEntry[] {
  const hidden = dismissedIds(forecasts, dismissals, 'home');
  const entries: RunningLowEntry[] = [];
  for (const f of forecasts) {
    if (!f.runningLow || !f.lowReason || hidden.has(f.productId)) continue;
    entries.push({
      productId: f.productId,
      name: names.get(f.productId) ?? '',
      totalQuantity: f.totalQuantity,
      reason: f.lowReason,
      daysLeft: f.daysLeft,
      runOut: f.runOut,
      confidence: f.confidence,
    });
  }
  return entries.sort(
    (a, b) =>
      Number(b.totalQuantity <= 0) - Number(a.totalQuantity <= 0) ||
      (a.daysLeft ?? 0) - (b.daysLeft ?? 0) ||
      a.totalQuantity - b.totalQuantity ||
      compareFr(a.name, b.name),
  );
}

/**
 * §5.11. Courses suggestions: running-low products, plus products whose forecast runs out before
 * the trip after next; minus products with an active 'courses' dismissal.
 */
export function shoppingList(
  forecasts: readonly ProductForecast[],
  names: ReadonlyMap<ProductId, string>,
  trip: NextTrip,
  dismissals: readonly Dismissal[],
  now: EpochMs,
): ShoppingList {
  const hidden = dismissedIds(forecasts, dismissals, 'courses');
  const horizon = trip.tripAt + trip.gapDays * DAY_MS;
  const entries: ShoppingListEntry[] = [];
  for (const f of forecasts) {
    if (f.deleted || !f.lowAlert || hidden.has(f.productId)) continue;
    let reason: ShoppingReason | null = f.runningLow ? f.lowReason : null;
    if (!reason && f.runOut && f.runOut.median <= horizon) reason = 'before-next-trip';
    if (!reason) continue;
    entries.push({
      productId: f.productId,
      name: names.get(f.productId) ?? '',
      quantity: suggestedQuantity(f),
      totalQuantity: f.totalQuantity,
      reason,
      urgencyDays: ((f.runOut ? f.runOut.median : now) - trip.tripAt) / DAY_MS,
      runOut: f.runOut,
      confidence: f.confidence,
    });
  }
  entries.sort(
    (a, b) => a.urgencyDays - b.urgencyDays || a.totalQuantity - b.totalQuantity || compareFr(a.name, b.name),
  );
  return { trip, entries };
}

// ---------------------------------------------------------------------------------------------
// Courses list merged with the household's grocery entries
// ---------------------------------------------------------------------------------------------

export type GroceryReason = ShoppingReason | 'manual';

export interface GroceryProductItem {
  kind: 'product';
  /** Stable React key: the entry id, or `suggested:<productId>` for a suggestion without a row. */
  key: string;
  productId: ProductId;
  name: string;
  /** Row backing this item; null for a pure suggestion (no row exists until the user acts). */
  entryId: GroceryId | null;
  /** Quantity to show: the entry's own quantity when set, else the suggested one. */
  quantity: number;
  /** Suggested quantity (§5.11), or null when the product has no forecast. */
  suggestedQuantity: number | null;
  reason: GroceryReason;
  /** Sort key of suggestions; null for manual rows. */
  urgencyDays: number | null;
  totalQuantity: number | null;
  runOut: RunOutBand | null;
  confidence: ForecastConfidence | null;
  checked: boolean;
  addedBy: UserId | null;
}

export interface GroceryLabelItem {
  kind: 'label';
  key: string;
  entryId: GroceryId;
  label: string;
  quantity: number | null;
  checked: boolean;
  addedBy: UserId | null;
}

export type GroceryItem = GroceryProductItem | GroceryLabelItem;

export interface GroceryList {
  trip: NextTrip;
  /** Unchecked rows: suggestions by urgency, then manual rows in creation order. */
  toBuy: GroceryItem[];
  /** «Dans le panier»: checked rows in check order. */
  inCart: GroceryItem[];
}

export interface GroceryListInput {
  forecasts: readonly ProductForecast[];
  /** Names of the live products; entries of products missing from this map are skipped. */
  names: ReadonlyMap<ProductId, string>;
  entries: readonly GroceryEntry[];
  trip: NextTrip;
  now: EpochMs;
  /** Device-local 'courses' dismissals (§5.12), in addition to dismissed grocery rows. */
  dismissals?: readonly Dismissal[];
}

const at = (iso: string | null) => (iso === null ? Number.NaN : Date.parse(iso));

/** A product's row-level state (dismissed or checked at `stamp`) holds until a later restock. */
function holdsUntilRestock(stamp: EpochMs, f: ProductForecast | undefined): boolean {
  return !f || f.lastRestockAt === null || f.lastRestockAt <= stamp;
}

/**
 * The Courses screen list: §5.11 suggestions merged with the household's grocery entries.
 * - A dismissed row (`dismissedAt`) hides the product's suggestion until its next restock.
 * - A checked row puts the product «Dans le panier» and hides its suggestion until the next restock.
 * - An open row of a suggested product becomes that suggestion (its own quantity wins when set).
 * - Other open rows are manual rows; a null quantity means «suggested» (at least 1).
 */
export function groceryList(input: GroceryListInput): GroceryList {
  const { forecasts, names, trip, now } = input;
  const byProduct = new Map(forecasts.map((f) => [f.productId, f]));
  const live = input.entries.filter((e) => e.deletedAt === null);

  const suppressed = new Set<ProductId>();
  for (const e of live) {
    if (e.productId === null) continue;
    const f = byProduct.get(e.productId);
    if (e.dismissedAt !== null && holdsUntilRestock(at(e.dismissedAt), f)) suppressed.add(e.productId);
    if (e.checkedAt !== null && holdsUntilRestock(at(e.checkedAt), f)) suppressed.add(e.productId);
  }

  const suggestions = new Map(
    shoppingList(forecasts, names, trip, input.dismissals ?? [], now)
      .entries.filter((s) => !suppressed.has(s.productId))
      .map((s) => [s.productId, s]),
  );

  const productItem = (e: GroceryEntry | null, productId: ProductId, checked: boolean): GroceryProductItem | null => {
    const name = names.get(productId);
    const f = byProduct.get(productId);
    if (name === undefined || f?.deleted) return null;
    const s = checked ? undefined : suggestions.get(productId);
    const suggested = s ? s.quantity : f ? suggestedQuantity(f) : null;
    return {
      kind: 'product',
      key: e ? e.id : `suggested:${productId}`,
      productId,
      name,
      entryId: e ? e.id : null,
      quantity: e?.quantity ?? suggested ?? 1,
      suggestedQuantity: suggested,
      reason: s ? s.reason : 'manual',
      urgencyDays: s ? s.urgencyDays : null,
      totalQuantity: f ? f.totalQuantity : null,
      runOut: f ? f.runOut : null,
      confidence: f ? f.confidence : null,
      checked,
      addedBy: e ? e.addedBy : null,
    };
  };

  const merged: GroceryProductItem[] = [];
  const manual: Array<{ item: GroceryItem; order: number }> = [];
  const cart: Array<{ item: GroceryItem; order: number }> = [];
  const claimed = new Set<ProductId>();

  for (const e of live) {
    if (e.dismissedAt !== null) continue;
    const checked = e.checkedAt !== null;
    let item: GroceryItem | null;
    if (e.productId !== null) {
      if (!checked && claimed.has(e.productId)) continue; // at most one open row per product (server natural key)
      item = productItem(e, e.productId, checked);
      if (item && !checked) claimed.add(e.productId);
    } else {
      item = {
        kind: 'label',
        key: e.id,
        entryId: e.id,
        label: e.label ?? '',
        quantity: e.quantity,
        checked,
        addedBy: e.addedBy,
      };
    }
    if (!item) continue;
    if (checked) cart.push({ item, order: at(e.checkedAt) });
    else if (item.kind === 'product' && item.reason !== 'manual') merged.push(item);
    else manual.push({ item, order: at(e.createdAt) });
  }

  for (const [productId] of suggestions) {
    if (claimed.has(productId)) continue;
    const item = productItem(null, productId, false);
    if (item) merged.push(item);
  }

  merged.sort(
    (a, b) =>
      (a.urgencyDays ?? 0) - (b.urgencyDays ?? 0) ||
      (a.totalQuantity ?? 0) - (b.totalQuantity ?? 0) ||
      compareFr(a.name, b.name),
  );
  const byOrder = (a: { order: number }, b: { order: number }) => (a.order || 0) - (b.order || 0);
  return {
    trip,
    toBuy: [...merged, ...manual.sort(byOrder).map((m) => m.item)],
    inCart: cart.sort(byOrder).map((c) => c.item),
  };
}
