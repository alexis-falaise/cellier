/**
 * Cellier — notifications and forecasting contract (types only).
 *
 * Companion of docs/architecture/04-notifications-forecasting.md. Section numbers in comments (§n)
 * refer to that document. This file is copied to `src/domain/notifications.ts` (client and service
 * worker) and to `supabase/functions/send-push/contract.ts` (Edge Function, Deno). It contains no
 * runtime code: values that the document fixes (TTL, urgency, thresholds) appear as literal types
 * or in comments, and the forecasting functions are declared with `declare function` so the
 * implementation in `src/domain/forecast/` must match these signatures exactly.
 *
 * Shared entity types (Product, Movement, ids) come from ./domain.ts.
 */

import type {
  CategoryKey,
  HouseholdId,
  IsoDate,
  IsoDateTime,
  Movement,
  PantryId,
  Product,
  ProductId,
  UserId,
} from './domain';

// =============================================================================================
// 1. Push payload (Edge Function → push service → device)                                   §2.1
// =============================================================================================

/** App routes a notification can open (§2.4). `:productId` is a ProductId. */
export type NotificationPath = '/' | '/groceries' | `/items/${string}`;

/**
 * Data carried by every notification. Read back by the service worker in `notificationclick`
 * (classic path) and available as `Notification.data` on the declarative path.
 */
export interface CellierNotificationData {
  /** Contract version of this object. */
  v: 1;
  kind: NotificationKind;
  householdId: HouseholdId;
  /** Products named by the notification (1 for a single running-low alert, n for a group or a digest). */
  productIds: ProductId[];
  /** Same-origin path to open; the absolute form is in `notification.navigate`. */
  path: NotificationPath;
  /** Outbox rows this notification delivers (diagnostics only). */
  outboxIds: number[];
  /** When the Edge Function built the message. */
  sentAt: IsoDateTime;
}

/**
 * The `notification` member. Follows the Declarative Web Push format shipped by WebKit on
 * iOS/iPadOS 18.4 (title and navigate required) and the NotificationOptions member names, so the
 * classic service-worker handler can pass it to `showNotification` unchanged.
 * No `app_badge`, `actions`, `image`, `icon` or `mutable`: see §2.1 and §2.5.
 */
export interface DeclarativeNotification {
  /** Non-empty, at most 60 characters after composition (§3.6). */
  title: string;
  /** At most 180 characters (§3.6). */
  body: string;
  /** Absolute https URL on the app origin: `${CELLIER_APP_URL}${data.path}`. */
  navigate: string;
  /** Collapse key, see `NotificationTag`. */
  tag: NotificationTag;
  lang: 'fr';
  dir: 'ltr';
  silent: false;
  data: CellierNotificationData;
}

/** The exact JSON object encrypted into every push message. Total UTF-8 size must stay under 3 000 bytes. */
export interface PushPayload {
  /** Declarative Web Push marker (RFC 8030 number). Immutable message: no top-level `mutable`. */
  web_push: 8030;
  notification: DeclarativeNotification;
}

/** Tags (§2.3). One live notification per tag on a device. */
export type NotificationTag =
  | `produit-${string}` // running_low, single product: `produit-<productId>`
  | `courses-${string}` // running_low, grouped: `courses-<householdId>`
  | `digest-${string}`; // daily digest: `digest-<householdId>`

/** Web Push request headers set by the Edge Function (§3.5). */
export interface PushDeliveryOptions {
  /** Seconds. running_low: 43 200 (12 h). digest: 14 400 (4 h). */
  ttl: 43_200 | 14_400;
  urgency: 'normal';
  /** base64url(SHA-256(tag)) truncated to 32 characters (RFC 8030 §5.4). */
  topic: string;
}

// =============================================================================================
// 2. Service worker ↔ page messages                                                          §2.4
// =============================================================================================

/** Posted by the service worker to an open window after a notification tap. */
export interface SwNavigateMessage {
  type: 'cellier:navigate';
  path: NotificationPath;
  data: CellierNotificationData | null;
}

/**
 * Written by the service worker to IndexedDB (database `cellier-sw`, store `push`, key `change`)
 * when a `pushsubscriptionchange` event arrives; read and cleared by the page on next start (§1.7).
 */
export interface PendingSubscriptionChange {
  at: IsoDateTime;
  oldEndpoint: string | null;
  /** Present when the browser supplied or the worker obtained a new subscription. */
  newSubscription: PushSubscriptionJSONStrict | null;
}

/** `PushSubscription.toJSON()` with the fields Cellier relies on made non-optional. */
export interface PushSubscriptionJSONStrict {
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
}

// =============================================================================================
// 3. Client-side subscription state                                                          §1
// =============================================================================================

/**
 * Registration goes through the RPC `register_push_subscription(p_endpoint, p_p256dh, p_auth,
 * p_user_agent)` → subscription id (uuid). It upserts by endpoint and moves the row to the current
 * account when another account used this device before (a plain upsert would hit RLS).
 */
export interface RegisterPushSubscriptionArgs {
  p_endpoint: string;
  p_p256dh: string;
  p_auth: string;
  p_user_agent: string | null;
}

/** Per-device preferences: direct PostgREST update of the caller's own row (column grants). */
export interface PushSubscriptionPrefsUpdate {
  notify_running_low?: boolean;
  notify_digest?: boolean;
  last_seen_at?: IsoDateTime;
}

/** Per-device record kept in IndexedDB `meta` under key `push` (§1.4). */
export interface LocalPushRecord {
  userId: UserId;
  endpoint: string;
  /** VITE_VAPID_PUBLIC_KEY used to create the subscription; a different build key forces re-subscribe. */
  vapidPublicKey: string;
  savedAt: IsoDateTime;
}

/** Result of the user-initiated enable flow (§1.3). */
export type EnablePushResult =
  | { ok: true }
  | { ok: false; reason: 'not-installed' | 'unsupported' | 'denied' | 'dismissed' | 'save-failed' | 'error' };

/** What the Notifications settings page shows (§1.2). */
export type PushAvailability =
  | 'unsupported' // no service worker / PushManager / Notification in this context
  | 'not-installed' // iOS, not running as a Home Screen web app
  | 'default' // installed, permission not asked yet
  | 'denied'
  | 'granted-subscribed'
  | 'granted-not-subscribed'; // granted but no subscription (lost); offer "Réactiver"

// =============================================================================================
// 4. Service-role RPCs (Edge Function → Postgres)                                             §3.4
// =============================================================================================

export type NotificationKind = 'running_low' | 'digest';

/** Argument of `public.notification_claim(p_limit integer default 50) returns jsonb`. */
export interface NotificationClaimArgs {
  p_limit?: number;
}

export interface ClaimedSubscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface ClaimedRecipient {
  userId: UserId;
  /** Never empty: members without a subscription are not returned. */
  subscriptions: ClaimedSubscription[];
}

export interface ClaimedProduct {
  id: ProductId;
  name: string;
  /** Household total at claim time (live pantries only). */
  totalQuantity: number;
  /** Effective minimum m at claim time (§3.1). */
  minQuantity: number;
}

export interface DigestLowProduct {
  id: ProductId;
  name: string;
  totalQuantity: number;
}

export interface DigestSoonProduct {
  id: ProductId;
  name: string;
  /** product_forecasts.run_out_at, ISO timestamp. */
  runOutAt: IsoDateTime;
}

export interface ClaimedDigest {
  lowProducts: DigestLowProduct[];
  runningOutSoon: DigestSoonProduct[];
  /** household_forecasts.next_trip_on, a Europe/Paris calendar date, or null. */
  nextTripOn: IsoDate | null;
}

export interface ClaimedItem {
  outboxId: number;
  kind: NotificationKind;
  householdId: HouseholdId;
  householdName: string;
  /** running_low: the product, or null when it no longer exists. digest: null. */
  product: ClaimedProduct | null;
  /** digest only. */
  digest: ClaimedDigest | null;
  /** running_low: members with notify_running_low, actor excluded. digest: members with notify_digest. */
  recipients: ClaimedRecipient[];
}

/** Return value of `notification_claim`. */
export interface NotificationClaimResult {
  items: ClaimedItem[];
}

/** 'retry': transient sender fault; the row returns to pending in 1 minute (failed after 5 claims). */
export type OutboxReportStatus = 'sent' | 'skipped' | 'failed' | 'retry';
export type SubscriptionReportResult = 'ok' | 'gone' | 'error';

export interface OutboxReport {
  outboxId: number;
  status: OutboxReportStatus;
  /** Short machine code (§3.7), never a product name or an endpoint. */
  error: string | null;
}

export interface SubscriptionReport {
  id: string;
  result: SubscriptionReportResult;
}

/**
 * Argument `p_report` of `public.notification_complete(p_report jsonb) returns void`.
 * Outbox rows deliberately left out are retried by the stale-'sending' requeue (§3.7).
 * Each subscription id appears at most once.
 */
export interface NotificationCompleteReport {
  outbox: OutboxReport[];
  subscriptions: SubscriptionReport[];
}

/** HTTP contract of the `send-push` Edge Function. Request: POST, header `x-cellier-secret`, body `{}`. */
export type SendPushResponse =
  | { status: 202; body: { accepted: true; alreadyRunning: boolean } }
  | { status: 401; body: { error: 'unauthorized' } }
  | { status: 405; body: { error: 'method_not_allowed' } };

/** One structured log line per invocation (§3.8). */
export interface SendPushInvocationLog {
  fn: 'send-push';
  event: 'done' | 'deadline' | 'shutdown' | 'error';
  executionId: string | null;
  rounds: number;
  claimed: number;
  sent: number;
  skipped: number;
  failed: number;
  retried: number;
  messages: number;
  subsOk: number;
  subsGone: number;
  subsError: number;
  senderFaults: number;
  ms: number;
}

// =============================================================================================
// 5. Published forecast rows (client → public.product_forecasts / household_forecasts)       §5.9
// =============================================================================================

export type ForecastConfidence = 'low' | 'medium' | 'high';

export interface ProductForecastRow {
  household_id: HouseholdId;
  product_id: ProductId;
  /** Rounded to 4 decimals. */
  rate_per_day: number;
  /** Rounded to 3 decimals, > 0. */
  rate_shape: number;
  usual_quantity: number | null;
  /** Rounded to 2 decimals; null when no usable forecast (§5.7). */
  days_left: number | null;
  run_out_at: IsoDateTime | null;
  confidence: ForecastConfidence;
  computed_at: IsoDateTime;
}

export interface HouseholdForecastRow {
  household_id: HouseholdId;
  cadence_days: number | null;
  /** Europe/Paris calendar date; null when no cadence (fewer than 3 restock sessions). */
  next_trip_on: IsoDate | null;
  confidence: ForecastConfidence;
  computed_at: IsoDateTime;
}

// =============================================================================================
// 6. Forecasting module public API (src/domain/forecast/)                                    §5
// =============================================================================================

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
 * movements (seq = null, ordered after every server row in outbox order).
 */
export type LedgerMovement = Pick<
  Movement,
  'id' | 'pantryId' | 'productId' | 'kind' | 'appliedDelta' | 'quantityAfter' | 'revertsId' | 'clientAt' | 'createdAt'
> & { seq: number | null };

/** One point of the household-total step function of a product (§5.2). */
export interface TotalPoint {
  /** Effective event time (§5.2: clamped client time, made non-decreasing). */
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
  /** Gamma shape a0 + Q. Always > 0. */
  shape: number;
  /** E, weighted in-stock days. */
  exposureDays: number;
  /** Q, weighted capped units. */
  weightedQuantity: number;
  /** Consume events inside the window (unweighted count). */
  events: number;
  /** Time the estimate refers to (§5.4: max(start of Paris day, last movement time)). */
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
  product: Pick<Product, 'id' | 'name' | 'minQuantity' | 'lowAlert' | 'deletedAt'>;
  /** Template key of the product's category; null (no category or custom category) uses 'autre'. */
  categoryKey: CategoryKey | null;
  /** Current household total from the stock cache plus pending overlay (live pantries only). */
  totalQuantity: number;
  /** All known movements of this product, any order; the module sorts by (seq ?? +∞, outbox order). */
  movements: readonly LedgerMovement[];
  /** Pantries whose deletedAt is not null; their movements are ignored. */
  deletedPantryIds: ReadonlySet<PantryId>;
  /** True when the household has a cadence (§5.8); needed for 'high' confidence. */
  householdHasCadence: boolean;
}

export type RunningLowReason = 'out' | 'threshold' | 'forecast';

export interface ProductForecast {
  productId: ProductId;
  totalQuantity: number;
  usualQuantity: number | null;
  /** Effective minimum m (§5.6). */
  minimum: number;
  /** Clear level c (§5.6). */
  clearLevel: number;
  rate: RateEstimate;
  /** Median days of cover from now; null when no forecast. 0 when total is 0. */
  daysLeft: number | null;
  /** null when no usable forecast (§5.7) or total is 0. */
  runOut: RunOutBand | null;
  confidence: ForecastConfidence;
  /** Replayed threshold state (identical rule to private.low_stock_state). */
  lowByThreshold: boolean;
  /** Usable forecast (§5.7) and daysLeft ≤ leadTime + safety. */
  lowByForecast: boolean;
  /** lowAlert && !deleted && (lowByThreshold || lowByForecast). */
  runningLow: boolean;
  /** Set when runningLow: 'out' if total is 0, else 'threshold' if lowByThreshold, else 'forecast'. */
  lowReason: RunningLowReason | null;
  /** Time of the newest restock movement of this product (server or pending), or null. */
  lastRestockAt: EpochMs | null;
  /** Highest server seq among this product's movements, or null. */
  lastSeq: number | null;
}

export interface Cadence {
  medianGapDays: number;
  /** 0 = Sunday … 6 = Saturday, in Europe/Paris. */
  usualWeekday: number;
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

/** Default constants (values in §5.13). */
export declare const DEFAULT_FORECAST_CONFIG: ForecastConfig;
export declare const CATEGORY_PRIORS: CategoryPriorTable;

/** §5.2. Household total step function of one product, from the ledger ordered by seq. */
export declare function reconstructTotals(
  productId: ProductId,
  movements: readonly LedgerMovement[],
  deletedPantryIds: ReadonlySet<PantryId>,
): TotalSeries;

/** §5.3. 'consume' movements with appliedDelta < 0 that no correction reverts. */
export declare function demandEvents(series: TotalSeries, movements: readonly LedgerMovement[]): DemandEvent[];

/** §5.5. Median post-restock level of the last 5 restock sessions within historyDays. */
export declare function usualQuantity(series: TotalSeries, now: EpochMs, cfg?: ForecastConfig): number | null;

/** §5.4. Exposure-weighted, decayed, Gamma-shrunk rate. */
export declare function consumptionRate(
  series: TotalSeries,
  events: readonly DemandEvent[],
  asOf: EpochMs,
  prior: CategoryPrior,
  eventCap: number,
  cfg?: ForecastConfig,
): RateEstimate;

/** §5.4. total / rate; 0 when total ≤ 0; Infinity when rate is 0. */
export declare function daysOfCover(total: number, ratePerDay: number): number;

/** §5.4. Log-normal 80 % band around asOf + cover. null when rate is 0 or total ≤ 0. */
export declare function runOutBand(total: number, rate: RateEstimate, cfg?: ForecastConfig): RunOutBand | null;

/** §5.6. m = minQuantity ?? max(1, ceil(0.25 · usual)) ?? 1. */
export declare function effectiveMinimum(minQuantity: number | null, usual: number | null): number;

/** §5.6. c = max(m + 1, ceil(0.5 · (usual ?? 0))). */
export declare function clearLevel(minimum: number, usual: number | null): number;

/** §5.6. Replays the threshold hysteresis over the series with the current settings. */
export declare function replayThresholdState(
  series: TotalSeries,
  minimum: number,
  clear: number,
  lowAlert: boolean,
  deleted: boolean,
): boolean;

/** §5.7. Everything about one product. Pure; memoised by the caller (§5.15). */
export declare function forecastProduct(
  input: ProductForecastInput,
  now: EpochMs,
  priors?: CategoryPriorTable,
  cfg?: ForecastConfig,
): ProductForecast;

/** §5.8. Household restock sessions → cadence. restockTimes: effective times of every restock movement. */
export declare function shoppingCadence(restockTimes: readonly EpochMs[], now: EpochMs, cfg?: ForecastConfig): Cadence | null;

/** §5.8. Next trip date. */
export declare function nextTrip(
  cadence: Cadence | null,
  forecasts: readonly ProductForecast[],
  now: EpochMs,
  cfg?: ForecastConfig,
): NextTrip;

/** §5.10. Accueil "Bientôt épuisé" list. */
export declare function runningLowView(
  forecasts: readonly ProductForecast[],
  names: ReadonlyMap<ProductId, string>,
  dismissals: readonly Dismissal[],
): RunningLowEntry[];

/** §5.11. Courses list. */
export declare function shoppingList(
  forecasts: readonly ProductForecast[],
  names: ReadonlyMap<ProductId, string>,
  trip: NextTrip,
  dismissals: readonly Dismissal[],
  now: EpochMs,
): ShoppingList;

/** §5.12. True when the dismissal still hides the product. */
export declare function isDismissalActive(d: Dismissal, forecast: ProductForecast): boolean;

/** §5.14. French wording of the likely run-out date (badge and detail). */
export declare function formatRunOut(
  forecast: ProductForecast,
  now: EpochMs,
  style: 'badge' | 'detail',
): string | null;

/** §5.14. French wording of the next trip, or null when there is no cadence. */
export declare function formatNextTrip(trip: NextTrip, now: EpochMs): string | null;

/** §5.9. Published row builders and the "material change" tests. */
export declare function toProductForecastRow(householdId: HouseholdId, f: ProductForecast, now: EpochMs): ProductForecastRow;
export declare function toHouseholdForecastRow(householdId: HouseholdId, trip: NextTrip, now: EpochMs): HouseholdForecastRow;
export declare function isMaterialProductChange(prev: ProductForecastRow | null, next: ProductForecastRow, now: EpochMs): boolean;
export declare function isMaterialHouseholdChange(prev: HouseholdForecastRow | null, next: HouseholdForecastRow, now: EpochMs): boolean;
