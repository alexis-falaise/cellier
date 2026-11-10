/**
 * Forecasting types. Mirrors section 6 of docs/architecture/contracts/notifications.ts (§5 of
 * 04-notifications-forecasting.md), with the small extensions marked «Extension».
 */
import type { CategoryKey, IsoDate, Movement, PantryId, Product, ProductId } from '@/domain/types';

/** Milliseconds since epoch. The module never reads the clock; `now` is always passed in. */
export type EpochMs = number;

export interface ForecastConfig {
  /** Demand window W, days. Default 90. */
  windowDays: number;
  /** Decay half-life H, days. Default 30. */
  halfLifeDays: number;
  /** Prior strength k, weighted pseudo-days. Default 14. */
  priorStrengthDays: number;
  /** Lead time, days. Default 2. */
  leadTimeDays: number;
  /** Safety margin, days. Default 2. Forecast low when days left ≤ leadTime + safety. */
  safetyDays: number;
  /** Restock merge gap, hours. Default 6. */
  sessionMergeHours: number;
  /** Cadence and usual-quantity look-back, days. Default 180. */
  historyDays: number;
  /** Minimum sessions for a cadence. Default 3. */
  minSessions: number;
  /** The n-th soonest run-out pulls the trip forward. Default 3. */
  criticalCount: number;
  /** Trip gap when no cadence exists, days. Default 7. */
  defaultTripGapDays: number;
  /** Minimum consume events in the window for a usable forecast. Default 3 (§5.7). */
  minEventsForForecast: number;
  /** z for the 80 % band. Default 1.2816. */
  bandZ: number;
  /** Device-clock trust for offline movements, days. Default 7 (§5.2). Extension: named here. */
  clientTimeTrustDays: number;
  /** IANA zone used for calendar days. Always 'Europe/Paris' in v1. */
  timeZone: 'Europe/Paris';
}

export interface CategoryPrior {
  /** Prior mean consumption, units per in-stock day. */
  ratePerDay: number;
  /** k, pseudo-exposure in weighted days. */
  strengthDays: number;
}

export type CategoryPriorTable = Readonly<Record<CategoryKey, CategoryPrior>>;

/**
 * One ledger movement as the forecast sees it: server rows from the store plus pending local
 * movements (seq = null, ordered after every server row in the order given).
 */
export type LedgerMovement = Pick<
  Movement,
  'id' | 'pantryId' | 'productId' | 'kind' | 'appliedDelta' | 'quantityAfter' | 'revertsId' | 'clientAt' | 'createdAt'
> & { seq: number | null };

/** One point of the household-total step function of a product (§5.2). */
export interface TotalPoint {
  /** Effective event time (clamped client time, made non-decreasing). */
  at: EpochMs;
  /** Household total across live pantries right after the movement. */
  total: number;
  movementId: string;
  kind: Movement['kind'];
}

export interface TotalSeries {
  productId: ProductId;
  /** Total before the first known movement (reconstructed from quantityAfter − appliedDelta). */
  initialTotal: number;
  points: TotalPoint[];
}

export interface DemandEvent {
  at: EpochMs;
  /** Units consumed, before the cap. */
  quantity: number;
}

export interface RateEstimate {
  /** Posterior mean (a0 + Q) / (b0 + E), units per in-stock day. */
  ratePerDay: number;
  /** Q / E, unshrunk; 0 when E = 0. */
  rawRate: number;
  /** Gamma shape a0 + Q. Always > 0 when the prior is > 0. */
  shape: number;
  /** E, weighted in-stock days. */
  exposureDays: number;
  /** Q, weighted capped units. */
  weightedQuantity: number;
  /** Consume events inside the window (unweighted count). */
  events: number;
  /** Time the estimate refers to (§5.4). */
  asOf: EpochMs;
}

export interface RunOutBand {
  median: EpochMs;
  /** ≈ 10th percentile. */
  earliest: EpochMs;
  /** ≈ 90th percentile. */
  latest: EpochMs;
}

export interface ProductForecastInput {
  /** Extension: `usualQuantity` is read so that a user-set «stock habituel» overrides the computed one. */
  product: Pick<Product, 'id' | 'name' | 'minQuantity' | 'usualQuantity' | 'lowAlert' | 'deletedAt'>;
  /** Template key of the product's category; null (no category or custom category) uses 'autre'. */
  categoryKey: CategoryKey | null;
  /** Current household total from the stock cache plus pending overlay (live pantries only). */
  totalQuantity: number;
  /** All known movements of this product, any order. */
  movements: readonly LedgerMovement[];
  /** Pantries whose deletedAt is not null; their movements are ignored. */
  deletedPantryIds: ReadonlySet<PantryId>;
  /** True when the household has a cadence (§5.8); needed for 'high' confidence. */
  householdHasCadence: boolean;
}

export type ForecastConfidence = 'low' | 'medium' | 'high';
export type RunningLowReason = 'out' | 'threshold' | 'forecast';

export interface ProductForecast {
  productId: ProductId;
  totalQuantity: number;
  /** Effective usual quantity: the product's own value when set, else the computed one. */
  usualQuantity: number | null;
  /** Extension: where `usualQuantity` comes from (design 03 §4.6.5 «Calculé» / «Saisi à la main»). */
  usualQuantitySource: 'user' | 'computed' | null;
  /** Effective minimum m (§5.6). */
  minimum: number;
  /** Clear level c (§5.6). */
  clearLevel: number;
  rate: RateEstimate;
  /** Median days of cover from now; null when no forecast. 0 when total is 0 and the product has history. */
  daysLeft: number | null;
  /** null when no usable forecast (§5.7) or total is 0. */
  runOut: RunOutBand | null;
  confidence: ForecastConfidence;
  /** Replayed threshold state (identical rule to private.low_stock_state). */
  lowByThreshold: boolean;
  /** Usable forecast and daysLeft ≤ leadTime + safety. */
  lowByForecast: boolean;
  /** lowAlert && !deleted && (lowByThreshold || lowByForecast). */
  runningLow: boolean;
  /** Set when runningLow: 'out' if total is 0, else 'threshold' if lowByThreshold, else 'forecast'. */
  lowReason: RunningLowReason | null;
  /** Time of the newest restock movement of this product (server or pending), or null. */
  lastRestockAt: EpochMs | null;
  /** Highest server seq among this product's movements, or null. */
  lastSeq: number | null;
  /** Extension: copied from the product so list builders need no product lookup. */
  lowAlert: boolean;
  /** Extension: product tombstoned. */
  deleted: boolean;
}

export interface Cadence {
  medianGapDays: number;
  /** 0 = Sunday … 6 = Saturday, in Europe/Paris. */
  usualWeekday: number;
  /** Extension: share of the considered session starts that fell on `usualWeekday` (design 03 §4.2.4). */
  usualWeekdayShare: number;
  sessions: number;
  confidence: ForecastConfidence;
  lastSessionAt: EpochMs;
  /** max(lastSessionAt + median gap, now + 1 day). */
  nextAt: EpochMs;
}

export interface NextTrip {
  /** min(cadence.nextAt (or now + default gap), n-th soonest median run-out), never before now. */
  tripAt: EpochMs;
  /** Europe/Paris date of tripAt when a cadence exists, else null. */
  tripOn: IsoDate | null;
  cadence: Cadence | null;
  /** Gap used for the "trip after next" horizon, days. */
  gapDays: number;
  /** Extension: true when the n-th soonest run-out moved the trip earlier than the cadence date. */
  pulledForward: boolean;
}

/** Device-local dismissals (§5.12). Two independent scopes. */
export type DismissalScope = 'home' | 'courses';

export interface Dismissal {
  productId: ProductId;
  scope: DismissalScope;
  dismissedAt: EpochMs;
  /** ProductForecast.lastRestockAt when dismissed; a newer restock clears the dismissal. */
  restockAtDismissal: EpochMs | null;
}

export interface RunningLowEntry {
  productId: ProductId;
  name: string;
  totalQuantity: number;
  reason: RunningLowReason;
  daysLeft: number | null;
  runOut: RunOutBand | null;
  confidence: ForecastConfidence;
}

export type ShoppingReason = 'out' | 'threshold' | 'forecast' | 'before-next-trip';

export interface ShoppingListEntry {
  productId: ProductId;
  name: string;
  /** Suggested quantity to buy, ≥ 1. */
  quantity: number;
  totalQuantity: number;
  reason: ShoppingReason;
  /** (median run-out − tripAt) in days; running-low items without a forecast use now. Sort key. */
  urgencyDays: number;
  runOut: RunOutBand | null;
  confidence: ForecastConfidence;
}

export interface ShoppingList {
  trip: NextTrip;
  entries: ShoppingListEntry[];
}
