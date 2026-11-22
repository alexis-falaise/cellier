import type { GroceryEntry, GroceryId, ProductId, UserId } from '@/domain/types';
import { compareText } from '@/shared/i18n';
import type { KindGroup } from './kinds';
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
      compareText(a.name, b.name),
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
    (a, b) => a.urgencyDays - b.urgencyDays || a.totalQuantity - b.totalQuantity || compareText(a.name, b.name),
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
  /** The product the row is about (put away on «Ranger»); for a kind's suggestion, its representative. */
  productId: ProductId;
  /** The kind («Café moulu») when the product has one, else the product name. */
  name: string;
  /** Row backing this item; null for a pure suggestion (no row exists until the user acts). */
  entryId: GroceryId | null;
  /**
   * Other open rows of the same kind, folded into this line (a list has one line per kind). They
   * are redundant: checking or hiding the line removes them.
   */
  foldedEntryIds: GroceryId[];
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
  /** List names of the live products (the kind when set); entries of products missing from this map are skipped. */
  names: ReadonlyMap<ProductId, string>;
  entries: readonly GroceryEntry[];
  trip: NextTrip;
  now: EpochMs;
  /** Device-local 'courses' dismissals (§5.12), in addition to dismissed grocery rows. */
  dismissals?: readonly Dismissal[];
  /**
   * Products that share their kind with another product (`KindMerge.groups`). The kind is one line:
   * its rows count for the representative, whose forecast carries the kind.
   */
  kinds?: ReadonlyMap<ProductId, KindGroup>;
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
 * - Products of one kind are one line: what is missing is «café moulu», not a given ground coffee.
 *   Their rows count for the kind (a check or dismissal of any of them holds for the kind), and
 *   extra open rows of the kind are folded into the first one (`foldedEntryIds`).
 */
export function groceryList(input: GroceryListInput): GroceryList {
  const { forecasts, names, trip, now } = input;
  const byProduct = new Map(forecasts.map((f) => [f.productId, f]));
  const live = input.entries.filter((e) => e.deletedAt === null);
  /** The line a product's rows belong to: its kind's representative, else the product itself. */
  const lineOf = (productId: ProductId): ProductId => input.kinds?.get(productId)?.representative ?? productId;

  const suppressed = new Set<ProductId>();
  for (const e of live) {
    if (e.productId === null) continue;
    const line = lineOf(e.productId);
    const f = byProduct.get(line);
    if (e.dismissedAt !== null && holdsUntilRestock(at(e.dismissedAt), f)) suppressed.add(line);
    if (e.checkedAt !== null && holdsUntilRestock(at(e.checkedAt), f)) suppressed.add(line);
  }

  const suggestions = new Map(
    shoppingList(forecasts, names, trip, input.dismissals ?? [], now)
      .entries.filter((s) => !suppressed.has(s.productId))
      .map((s) => [s.productId, s]),
  );

  const productItem = (e: GroceryEntry | null, productId: ProductId, checked: boolean): GroceryProductItem | null => {
    const name = names.get(productId);
    const own = byProduct.get(productId);
    if (name === undefined || own?.deleted) return null;
    const line = lineOf(productId);
    // A kind's figures (stock, run-out, suggested quantity) are carried by its representative.
    const f = byProduct.get(line) ?? own;
    const s = checked ? undefined : suggestions.get(line);
    const suggested = s ? s.quantity : f ? suggestedQuantity(f) : null;
    return {
      kind: 'product',
      key: e ? e.id : `suggested:${productId}`,
      productId,
      name,
      entryId: e ? e.id : null,
      foldedEntryIds: [],
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
  /** The open line of each product or kind: at most one (server natural key per product, folding per kind). */
  const open = new Map<ProductId, GroceryProductItem>();

  for (const e of live) {
    if (e.dismissedAt !== null) continue;
    const checked = e.checkedAt !== null;
    let item: GroceryItem | null;
    if (e.productId !== null) {
      const line = lineOf(e.productId);
      const holder = checked ? undefined : open.get(line);
      if (holder) {
        holder.foldedEntryIds.push(e.id);
        continue;
      }
      item = productItem(e, e.productId, checked);
      if (item && !checked) open.set(line, item);
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
    if (open.has(productId)) continue;
    const item = productItem(null, productId, false);
    if (item) merged.push(item);
  }

  merged.sort(
    (a, b) =>
      (a.urgencyDays ?? 0) - (b.urgencyDays ?? 0) ||
      (a.totalQuantity ?? 0) - (b.totalQuantity ?? 0) ||
      compareText(a.name, b.name),
  );
  const byOrder = (a: { order: number }, b: { order: number }) => (a.order || 0) - (b.order || 0);
  return {
    trip,
    toBuy: [...merged, ...manual.sort(byOrder).map((m) => m.item)],
    inCart: cart.sort(byOrder).map((c) => c.item),
  };
}
