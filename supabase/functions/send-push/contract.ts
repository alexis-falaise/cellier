/**
 * Subset of docs/architecture/contracts/notifications.ts used by the send-push Edge Function.
 * Copied (the function cannot import from docs/). Branded ids from contracts/domain.ts are plain
 * strings here: the values arrive as JSON from Postgres.
 */

export type HouseholdId = string;
export type ProductId = string;
export type UserId = string;
export type IsoDate = string;
export type IsoDateTime = string;

// --- Push payload (§2.1) ----------------------------------------------------------------------

export type NotificationKind = 'running_low' | 'digest';
export type NotificationPath = '/' | '/groceries' | `/items/${string}`;
export type NotificationTag = `produit-${string}` | `courses-${string}` | `digest-${string}`;

export interface CellierNotificationData {
  v: 1;
  kind: NotificationKind;
  householdId: HouseholdId;
  productIds: ProductId[];
  path: NotificationPath;
  outboxIds: number[];
  sentAt: IsoDateTime;
}

export interface DeclarativeNotification {
  title: string;
  body: string;
  navigate: string;
  tag: NotificationTag;
  lang: 'fr';
  dir: 'ltr';
  silent: false;
  data: CellierNotificationData;
}

export interface PushPayload {
  web_push: 8030;
  notification: DeclarativeNotification;
}

export interface PushDeliveryOptions {
  ttl: 43_200 | 14_400;
  urgency: 'normal';
  topic: string;
}

// --- Service-role RPCs (§3.4) -----------------------------------------------------------------

export interface ClaimedSubscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface ClaimedRecipient {
  userId: UserId;
  subscriptions: ClaimedSubscription[];
}

export interface ClaimedProduct {
  id: ProductId;
  name: string;
  totalQuantity: number;
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
  runOutAt: IsoDateTime;
}

export interface ClaimedDigest {
  lowProducts: DigestLowProduct[];
  runningOutSoon: DigestSoonProduct[];
  nextTripOn: IsoDate | null;
}

export interface ClaimedItem {
  outboxId: number;
  kind: NotificationKind;
  householdId: HouseholdId;
  householdName: string;
  product: ClaimedProduct | null;
  digest: ClaimedDigest | null;
  recipients: ClaimedRecipient[];
}

export interface NotificationClaimResult {
  items: ClaimedItem[];
}

export type OutboxReportStatus = 'sent' | 'skipped' | 'failed' | 'retry';
export type SubscriptionReportResult = 'ok' | 'gone' | 'error';

export interface OutboxReport {
  outboxId: number;
  status: OutboxReportStatus;
  error: string | null;
}

export interface SubscriptionReport {
  id: string;
  result: SubscriptionReportResult;
}

export interface NotificationCompleteReport {
  outbox: OutboxReport[];
  subscriptions: SubscriptionReport[];
}

// --- Logging (§3.8) ---------------------------------------------------------------------------

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
