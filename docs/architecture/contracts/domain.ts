/**
 * Cellier — shared domain types (contract).
 *
 * This file is copied verbatim to `src/domain/types.ts` by work package 0 and is the single
 * source of truth for entity shapes on the client. The shapes match, field for field, the JSON
 * produced by the database functions `pull_changes` and `apply_mutations`
 * (supabase/migrations/20261110120700_apply_mutations.sql, 20261110120800_pull_changes.sql, 20261110120900_household_rpcs.sql). Keys are camelCase on the wire, so no mapping
 * layer exists between the RPC payloads and the store.
 *
 * Conventions:
 * - Ids are UUID v4 strings, generated on the client for pantries, categories, products and
 *   movements (so optimistic rows keep their identity), and by the server for households,
 *   invites and the in-leg of a transfer.
 * - Timestamps are ISO 8601 strings in UTC as produced by Postgres `to_jsonb(timestamptz)`.
 * - Quantities of stock are integers (units or packs as the household counts them).
 * - `null` means "no value"; optional (`?`) fields are only used in mutation arguments.
 */

// ---------------------------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------------------------

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type HouseholdId = Brand<string, 'HouseholdId'>;
export type UserId = Brand<string, 'UserId'>;
export type PantryId = Brand<string, 'PantryId'>;
export type CategoryId = Brand<string, 'CategoryId'>;
export type ProductId = Brand<string, 'ProductId'>;
export type MovementId = Brand<string, 'MovementId'>;
export type MutationId = Brand<string, 'MutationId'>;
export type DeviceId = Brand<string, 'DeviceId'>;
/** 14-digit GTIN, the canonical barcode key (see contracts/catalogue.ts for parsing). */
export type Gtin = Brand<string, 'Gtin'>;
/** Key of a stock row: `${pantryId}:${productId}`. */
export type StockKey = `${string}:${string}`;
/** Hybrid logical clock: `${wall ms, 15 digits}.${counter, 6 digits}.${deviceId}`. */
export type Hlc = Brand<string, 'Hlc'>;
/** ISO 8601 timestamp string. */
export type IsoDateTime = string;
/** ISO calendar date `YYYY-MM-DD`. */
export type IsoDate = string;

export const stockKey = (pantryId: PantryId, productId: ProductId): StockKey => `${pantryId}:${productId}`;

// ---------------------------------------------------------------------------------------------
// Reference data (global, read-only)
// ---------------------------------------------------------------------------------------------

/** The 28 default category slugs (research/06). The design system maps each slug to an icon and a colour token. */
export const CATEGORY_KEYS = [
  'legumes', 'fruits', 'feculents', 'poisson', 'viande', 'laitier', 'pain', 'apero',
  'epicerie_sucree', 'chocolat', 'petit_dej', 'conserves', 'surgeles', 'plats', 'soft', 'jus',
  'eau', 'vin', 'biere', 'cafe', 'condiments', 'bebe', 'animaux', 'entretien', 'hygiene',
  'papier', 'pharmacie', 'autre',
] as const;
export type CategoryKey = (typeof CATEGORY_KEYS)[number];

export interface CategoryTemplate {
  key: CategoryKey;
  name: string;
  sortOrder: number;
}

export type NetUnit = 'g' | 'ml' | 'piece';

// ---------------------------------------------------------------------------------------------
// Synced entities (rows of the local store)
// ---------------------------------------------------------------------------------------------

export type Role = 'owner' | 'member';

export interface Household {
  id: HouseholdId;
  name: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface Member {
  householdId: HouseholdId;
  userId: UserId;
  role: Role;
  displayName: string;
  avatarUrl: string | null;
  notifyRunningLow: boolean;
  notifyDigest: boolean;
  joinedAt: IsoDateTime;
}

export interface Pantry {
  id: PantryId;
  householdId: HouseholdId;
  name: string;
  /** Design icon key; null = the design default for pantries. */
  icon: string | null;
  /** Design colour token; null = default. */
  color: string | null;
  sortOrder: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  /** Tombstone. A deleted pantry is hidden; its stock is excluded from totals. */
  deletedAt: IsoDateTime | null;
}

export interface Category {
  id: CategoryId;
  householdId: HouseholdId;
  /** Default this category was seeded from; null for a custom category. */
  templateKey: CategoryKey | null;
  name: string;
  /** null = the design default for `templateKey` (or the generic icon for a custom category). */
  icon: string | null;
  color: string | null;
  sortOrder: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  deletedAt: IsoDateTime | null;
}

export type PriceSource = 'catalog' | 'user';

export interface Product {
  id: ProductId;
  householdId: HouseholdId;
  name: string;
  brand: string | null;
  /** Scanned barcode, if any. Unique per household (natural key). */
  gtin: Gtin | null;
  /** Catalogue row this product was created from, if any. */
  catalogGtin: Gtin | null;
  /** null = "Sans catégorie". A tombstoned category is displayed as none. */
  categoryId: CategoryId | null;
  /** Content of one element, in `netUnit`. */
  netQuantity: number | null;
  netUnit: NetUnit | null;
  /** Elements per pack (multipacks). */
  packCount: number | null;
  priceCents: number | null;
  priceSource: PriceSource | null;
  /** Household-wide minimum (the «seuil»; design `min_qty`). null = default rule (see 04-notifications-forecasting.md). */
  minQuantity: number | null;
  /** Usual purchase size override (design `usual_qty`). null = the forecast's value. */
  usualQuantity: number | null;
  /** false = this product is never reported as running low. */
  lowAlert: boolean;
  imageUrl: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  deletedAt: IsoDateTime | null;
}

/** Quantity of one product in one pantry. Server-maintained cache of the ledger. */
export interface StockRow {
  householdId: HouseholdId;
  pantryId: PantryId;
  productId: ProductId;
  quantity: number;
  updatedAt: IsoDateTime;
}

/**
 * Ledger kinds. UI grouping (design 03 §5): purchase = restock; consume = consume | discard;
 * recount; transfer = transfer_out + transfer_in (same transferId); correction = undo.
 */
export type MovementKind =
  | 'restock'       // added to a pantry (purchase)
  | 'consume'       // used up — the only kind that counts as demand for forecasting
  | 'discard'       // thrown away / expired
  | 'recount'       // physical count; delta computed by the server at apply time
  | 'transfer_out'  // moved out of a pantry
  | 'transfer_in'   // moved into a pantry
  | 'correction';   // undo of an earlier movement

export interface Movement {
  id: MovementId;
  /** Server apply order, global and monotonic. Use it, not timestamps, to order the ledger. */
  seq: number;
  householdId: HouseholdId;
  pantryId: PantryId;
  productId: ProductId;
  kind: MovementKind;
  /** Recount only: the counted quantity. */
  counted: number | null;
  requestedDelta: number;
  appliedDelta: number;
  /** Pantry quantity right after this movement. */
  quantityAfter: number;
  transferId: string | null;
  revertsId: MovementId | null;
  /** null when the member's account was deleted. */
  actorId: UserId | null;
  /** UI origin, for Activity grouping. 'undo' is set by the server on corrections. */
  source: MovementSource | null;
  clientAt: IsoDateTime | null;
  createdAt: IsoDateTime;
}

export type MovementSource = 'scan' | 'swipe' | 'stepper' | 'put_away' | 'form' | 'undo';

export type GroceryId = Brand<string, 'GroceryId'>;

/**
 * Courses entry. Either a product of the household or a free-text label. Checking an entry never
 * changes stock (put-away is a separate stock.add). Running-low products are suggested by the client
 * without a row; dismissing a suggestion creates an entry with dismissedAt set.
 */
export interface GroceryEntry {
  id: GroceryId;
  householdId: HouseholdId;
  productId: ProductId | null;
  label: string | null;
  /** null = suggested quantity (usual quantity minus stock, at least 1). */
  quantity: number | null;
  addedBy: UserId | null;
  checkedAt: IsoDateTime | null;
  checkedBy: UserId | null;
  dismissedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  deletedAt: IsoDateTime | null;
}

/**
 * A value written by one device and replaced by a later write from another device (design
 * «Modification remplacée»). Show it to the user whose device id ends `oldHlc`. Server-written, read-only.
 */
export interface FieldOverwrite {
  id: string;
  householdId: HouseholdId;
  entity: 'household' | 'pantry' | 'category' | 'product' | 'grocery';
  rowId: string;
  /** Mutation field name, e.g. 'priceCents'. */
  field: string;
  oldValue: unknown;
  newValue: unknown;
  oldHlc: Hlc;
  newHlc: Hlc;
  /** Author of the new value. */
  actorId: UserId | null;
  createdAt: IsoDateTime;
}

/** Entity names used by the change log, pull responses and store maps. */
export type EntityName =
  | 'household' | 'member' | 'pantry' | 'category' | 'product' | 'stock' | 'movement' | 'grocery' | 'overwrite';

export interface EntityRowMap {
  household: Household;
  member: Member;
  pantry: Pantry;
  category: Category;
  product: Product;
  stock: StockRow;
  movement: Movement;
  grocery: GroceryEntry;
  overwrite: FieldOverwrite;
}

// ---------------------------------------------------------------------------------------------
// Mutations (client → server, through the outbox and `apply_mutations`)
// ---------------------------------------------------------------------------------------------

export interface PantryFields { name?: string; icon?: string | null; color?: string | null; sortOrder?: number }
export interface CategoryFields { name?: string; icon?: string | null; color?: string | null; sortOrder?: number }
export interface ProductFields {
  name?: string;
  brand?: string | null;
  categoryId?: CategoryId | null;
  netQuantity?: number | null;
  netUnit?: NetUnit | null;
  packCount?: number | null;
  priceCents?: number | null;
  priceSource?: PriceSource | null;
  minQuantity?: number | null;
  usualQuantity?: number | null;
  lowAlert?: boolean;
  imageUrl?: string | null;
}
export interface GroceryFields { label?: string; quantity?: number | null; checked?: boolean; dismissed?: boolean }

/** Argument types per mutation name. See 02-sync-protocol.md §3 for effects and conflict rules. */
export interface MutationArgs {
  'household.rename': { name: string };
  'member.updateSelf': { displayName?: string; notifyRunningLow?: boolean; notifyDigest?: boolean };

  'pantry.create': { pantryId: PantryId; name: string; icon?: string | null; color?: string | null; sortOrder?: number };
  'pantry.update': { pantryId: PantryId; fields: PantryFields };
  'pantry.delete': { pantryId: PantryId };
  'pantry.restore': { pantryId: PantryId };

  'category.create': { categoryId: CategoryId; name: string; icon?: string | null; color?: string | null; sortOrder?: number };
  'category.update': { categoryId: CategoryId; fields: CategoryFields };
  'category.delete': { categoryId: CategoryId };
  'category.restore': { categoryId: CategoryId };

  'product.create': { productId: ProductId; name: string; gtin?: Gtin | null; catalogGtin?: Gtin | null } & Omit<ProductFields, 'name'>;
  'product.update': { productId: ProductId; fields: ProductFields };
  'product.delete': { productId: ProductId };
  'product.restore': { productId: ProductId };

  'stock.add': { pantryId: PantryId; productId: ProductId; quantity: number; source?: MovementSource };
  'stock.remove': { pantryId: PantryId; productId: ProductId; quantity: number; reason: 'consume' | 'discard'; source?: MovementSource };
  'stock.recount': { pantryId: PantryId; productId: ProductId; counted: number; source?: MovementSource };
  'stock.transfer': { fromPantryId: PantryId; toPantryId: PantryId; productId: ProductId; quantity: number; source?: MovementSource };
  'stock.revert': { movementId: MovementId };

  /** Exactly one of productId and label. Merges into the open entry of the same product. */
  'grocery.add': { groceryId: GroceryId; productId?: ProductId | null; label?: string | null; quantity?: number | null };
  'grocery.update': { groceryId: GroceryId; fields: GroceryFields };
  'grocery.delete': { groceryId: GroceryId };
  'grocery.restore': { groceryId: GroceryId };
}

export type MutationName = keyof MutationArgs;

/** One mutation as sent on the wire (element of `apply_mutations` request `mutations`). */
export interface MutationEnvelope<N extends MutationName = MutationName> {
  /** Idempotency key, generated when the user acts; for stock mutations also the movement id. */
  id: MutationId;
  /** Per-device sequence number, strictly increasing, persisted. */
  seq: number;
  name: N;
  args: MutationArgs[N];
  /** HLC stamped when the user acted; decides per-field last-writer-wins. */
  hlc: Hlc;
  clientAt: IsoDateTime;
}

export type AnyMutationEnvelope = { [N in MutationName]: MutationEnvelope<N> }[MutationName];

export interface ApplyMutationsRequest {
  householdId: HouseholdId;
  deviceId: DeviceId;
  /** 1..50 mutations in `seq` order; the JSON body must stay under 256 KB. */
  mutations: AnyMutationEnvelope[];
}

/**
 * Terminal statuses: applied, clamped, gone, invalid, forbidden.
 * Non-terminal: retry (nothing was decided; the server stopped processing the batch there).
 */
export type MutationStatus = 'applied' | 'clamped' | 'gone' | 'invalid' | 'forbidden' | 'retry';

export type MutationErrorCode =
  | 'name_taken'          // natural-key collision on rename (pantry, category, custom product)
  | 'gtin_taken'          // another product of the household already has this barcode
  | 'not_found'           // referenced row does not exist in this household
  | 'not_owner'           // owner-only mutation
  | 'already_reverted'    // stock.revert on a movement that was already reverted
  | 'not_revertible'      // stock.revert on a correction or recount
  | 'validation'          // argument failed validation (message says which)
  | 'unknown_mutation'
  | 'transient';          // retry only: lock timeout, serialization failure, deadlock

export interface CreateResultData {
  /** Id the row has on the server. Differs from the requested id after an add-vs-add merge. */
  canonicalId: string;
  merged: boolean;
  /** true when the create revived a tombstoned row with the same natural key. */
  restored: boolean;
}

export interface UpdateResultData {
  /** Fields of this mutation that lost to a newer write (HLC) and were not applied. */
  rejectedFields: string[];
}

export interface StockResultData {
  movementId: MovementId;
  requested: number;
  applied: number;
  quantityAfter: number;
  /** stock.transfer only. */
  inMovementId?: MovementId | null;
  toQuantityAfter?: number | null;
  /** stock.revert only: the correction movements written. */
  movementIds?: MovementId[];
}

export interface MutationResult {
  id: MutationId;
  status: MutationStatus;
  /** true when this result was stored by an earlier call (idempotent replay). */
  replayed?: boolean;
  code?: MutationErrorCode;
  /** Developer message; never shown to users as is. */
  message?: string;
  data?: CreateResultData | UpdateResultData | StockResultData;
}

export interface ApplyMutationsResponse {
  /** 'not_member': the caller is not a member of the household; every result is 'forbidden'. */
  status: 'ok' | 'not_member';
  /** Server clock, for HLC observation and skew warnings. */
  serverTime: IsoDateTime;
  /** Household head sync id after this call; the store keeps acked mutations in the overlay until its cursor reaches it. */
  lastSyncId: number;
  /** One result per processed mutation, in request order. Shorter than the request when processing stopped at a 'retry'. */
  results: MutationResult[];
}

// ---------------------------------------------------------------------------------------------
// Pull (server → client, `pull_changes`)
// ---------------------------------------------------------------------------------------------

export interface PullRequest {
  householdId: HouseholdId;
  /** 0 = snapshot. Otherwise the cursor (`toSyncId`) of the last applied pull. */
  since: number;
  /** Max change-log entries per page in delta mode (1..1000, default 500). */
  limit?: number;
}

export interface PullUpserts {
  household: Household[];
  member: Member[];
  pantry: Pantry[];
  category: Category[];
  product: Product[];
  stock: StockRow[];
  movement: Movement[];
  grocery: GroceryEntry[];
  overwrite: FieldOverwrite[];
}

export interface PullDelete {
  entity: 'member' | 'stock' | 'movement' | 'pantry' | 'category' | 'product' | 'household' | 'grocery';
  /** Same id format as change_log.row_id: uuid, member userId, or StockKey. */
  id: string;
}

export interface PullResponse {
  /**
   * ok: apply the page. resync_required: `since` is older than the retained change log; call again with since = 0.
   * not_member: the caller is not (or no longer) a member of this household.
   */
  status: 'ok' | 'resync_required' | 'not_member';
  /** snapshot: replace every base row of the household with this content. delta: merge. */
  mode: 'snapshot' | 'delta';
  /** Cursor to persist after applying this page. */
  toSyncId: number;
  /** Household head at the time of the read. */
  headSyncId: number;
  /** Delta mode: more pages after this one; call again with since = toSyncId. */
  hasMore: boolean;
  serverTime: IsoDateTime;
  upserts: PullUpserts;
  deletes: PullDelete[];
}

/** Realtime broadcast payload on the private channel `household:<householdId>`, event 'sync'. */
export interface SyncNudge {
  syncId: number;
}
/** Event 'household_deleted' on the same channel. */
export interface HouseholdDeletedNudge {
  householdId: HouseholdId;
}

// ---------------------------------------------------------------------------------------------
// Household management RPCs (online only; not queued)
// ---------------------------------------------------------------------------------------------

export interface CreateHouseholdArgs { p_household_id: HouseholdId; p_name: string; p_pantry_id: PantryId; p_pantry_name: string }
export interface CreateHouseholdResult { householdId: HouseholdId; created: boolean }

/** Single-use, 7-day code of 8 Crockford base-32 characters. Link: /join#<code>. */
export interface CreateInviteArgs { p_household_id: HouseholdId }
export interface CreateInviteResult { inviteId: string; code: string; expiresAt: IsoDateTime }

export type InviteStatus = 'valid' | 'expired' | 'revoked' | 'used_up' | 'not_found' | 'already_member' | 'rate_limited';

/** `peek_invite(p_code)`: callable before sign-in (anon). Names are null unless status is valid/already_member. */
export interface InvitePeek {
  status: InviteStatus;
  householdName: string | null;
  inviterFirstName: string | null;
  expiresAt: IsoDateTime | null;
}

export interface AcceptInviteResult {
  status: Exclude<InviteStatus, 'valid'> | 'joined';
  householdId: HouseholdId | null;
}

/** Other RPCs: `delete_account()` → void; `delete_household(p_household_id)` → void (owner);
 *  `leave_household`, `remove_member`, `transfer_ownership`, `revoke_invite(p_invite_id)` → void;
 *  `register_push_subscription(p_endpoint, p_p256dh, p_auth, p_user_agent)` → subscription id. */

/** Message keys raised (SQLSTATE P0001) by the household RPCs; the UI maps each to French copy. */
export type HouseholdRpcError =
  | 'not_authenticated' | 'not_member' | 'not_owner' | 'household_exists' | 'too_many_households'
  | 'owner_must_transfer' | 'cannot_remove_owner' | 'target_not_member' | 'invalid_argument';

export interface InviteListItem {
  id: string;
  createdAt: IsoDateTime;
  expiresAt: IsoDateTime;
  uses: number;
  revokedAt: IsoDateTime | null;
}

// ---------------------------------------------------------------------------------------------
// Derived (client-only) view types
// ---------------------------------------------------------------------------------------------

/** Product with its household-wide stock, computed by store selectors from base + overlay. */
export interface ProductView {
  product: Product;
  category: Category | null;
  /** Sum over live pantries. */
  totalQuantity: number;
  perPantry: ReadonlyArray<{ pantryId: PantryId; quantity: number }>;
  /** Created-at of the newest restock movement, for "recency" sorting. */
  lastRestockAt: IsoDateTime | null;
  /** True when at least one queued mutation touches this product. */
  pending: boolean;
}

export type InventorySort = 'name' | 'category' | 'recency' | 'price' | 'quantity';
export type InventoryGroup = 'none' | 'category' | 'pantry';

export type SyncStatus =
  | { kind: 'booting' }
  | { kind: 'idle'; lastSyncedAt: IsoDateTime | null }
  | { kind: 'syncing' }
  | { kind: 'offline'; pendingCount: number }
  | { kind: 'error'; pendingCount: number; retryAt: number; reason: 'transport' | 'server' | 'auth' | 'contract' };
