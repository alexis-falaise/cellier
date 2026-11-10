/**
 * French copy and payload composition (§2.1, §2.3, §3.6, §4). Pure functions, no I/O.
 * Typography: U+00A0 before «:», typographic apostrophe ’, single-character ellipsis ….
 */

import type {
  ClaimedDigest,
  ClaimedProduct,
  HouseholdId,
  NotificationKind,
  NotificationPath,
  NotificationTag,
  ProductId,
  PushPayload,
} from './contract.ts';

export const NBSP = ' ';
export const MAX_NAME = 40;
export const MAX_TITLE = 60;
export const MAX_BODY = 180;
export const MAX_PAYLOAD_BYTES = 3000;
export const TTL_RUNNING_LOW = 43_200;
export const TTL_DIGEST = 14_400;
export const RUNNING_LOW_BODY = 'Seuil d’alerte atteint. Ajout automatique à Courses.';

const collator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });
const qtyFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

/** Cuts to `max` code points, the last one being «…» when cut. */
export function truncate(s: string, max: number): string {
  const chars = Array.from(s);
  return chars.length <= max ? s : `${chars.slice(0, max - 1).join('').trimEnd()}…`;
}

export function productName(name: string): string {
  const t = name.trim().replace(/\s+/g, ' ');
  return truncate(t || 'Article', MAX_NAME);
}

function articles(n: number): string {
  return n === 1 ? 'article' : 'articles';
}

/** «A», «A et B», «A, B et C», «A, B, C et 1 autre», «A, B, C et 2 autres» (§3.6). */
export function nameListEt(names: string[]): string {
  const shown = names.slice(0, 3).map(productName);
  const rest = names.length - shown.length;
  if (rest > 0) return `${shown.join(', ')} et ${rest} ${rest === 1 ? 'autre' : 'autres'}`;
  if (shown.length <= 1) return shown.join('');
  return `${shown.slice(0, -1).join(', ')} et ${shown[shown.length - 1]}`;
}

/** «A, B, C +2» (§4). */
export function nameListPlus(names: string[]): string {
  const shown = names.slice(0, 3).map(productName).join(', ');
  const rest = names.length - 3;
  return rest > 0 ? `${shown} +${rest}` : shown;
}

/** A composed message, before payload serialisation. */
export interface Copy {
  kind: NotificationKind;
  title: string;
  body: string;
  path: NotificationPath;
  tag: NotificationTag;
  ttl: typeof TTL_RUNNING_LOW | typeof TTL_DIGEST;
  productIds: ProductId[];
}

// --- Running low (§3.6) -----------------------------------------------------------------------

/** Restocked during the debounce window, or deleted: the item is skipped. */
export function runningLowSkipReason(product: ClaimedProduct | null): 'product_gone' | null {
  // `no_longer_low` (totalQuantity > minQuantity) is not re-tested here: notification_claim only
  // returns products whose private.low_stock_state.is_low is true (it skips the others itself), and
  // its `minQuantity` is `coalesce(min_quantity, 1)`, not the effective minimum of §3.1, so a
  // client-side comparison would wrongly drop alerts of products whose minimum comes from usage.
  return product ? null : 'product_gone';
}

export function composeRunningLow(householdId: HouseholdId, products: ClaimedProduct[]): Copy {
  if (products.length === 1) {
    const p = products[0];
    const name = productName(p.name);
    const title = p.totalQuantity > 0 ? `${name}${NBSP}: plus que ${qtyFormat.format(p.totalQuantity)}` : `${name}${NBSP}: stock épuisé`;
    return {
      kind: 'running_low',
      title: truncate(title, MAX_TITLE),
      body: RUNNING_LOW_BODY,
      path: `/items/${p.id}`,
      tag: `produit-${p.id}`,
      ttl: TTL_RUNNING_LOW,
      productIds: [p.id],
    };
  }
  return {
    kind: 'running_low',
    title: truncate(`${products.length} articles à racheter`, MAX_TITLE),
    body: truncate(nameListEt(products.map((p) => p.name)), MAX_BODY),
    path: '/groceries',
    tag: `courses-${householdId}`,
    ttl: TTL_RUNNING_LOW,
    productIds: products.map((p) => p.id),
  };
}

// --- Digest (§4) ------------------------------------------------------------------------------

/** Europe/Paris calendar date (YYYY-MM-DD) of an instant. */
export function parisDate(nowMs: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(nowMs));
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type Trip = 'today' | 'tomorrow' | null;

export function tripOf(nextTripOn: string | null, nowMs: number): Trip {
  if (!nextTripOn) return null;
  const today = parisDate(nowMs);
  const day = nextTripOn.slice(0, 10);
  if (day <= today) return 'today';
  if (day === addDays(today, 1)) return 'tomorrow';
  return null;
}

const STALE_MS = 30 * 86_400_000;

export function digestLists(digest: ClaimedDigest, nowMs: number) {
  const low = [...(digest.lowProducts ?? [])].sort(
    (a, b) => a.totalQuantity - b.totalQuantity || collator.compare(a.name, b.name),
  );
  const lowIds = new Set(low.map((p) => p.id));
  const soon = (digest.runningOutSoon ?? [])
    .map((p) => ({ ...p, t: Date.parse(p.runOutAt) }))
    .filter((p) => !lowIds.has(p.id) && Number.isFinite(p.t) && p.t >= nowMs - STALE_MS)
    .sort((a, b) => a.t - b.t);
  return { low, soon };
}

/** Returns null when there is nothing to report (item skipped with `empty_digest`). */
export function composeDigest(householdId: HouseholdId, digest: ClaimedDigest, nowMs: number): Copy | null {
  const { low, soon } = digestLists(digest, nowMs);
  const n = low.length + soon.length;
  if (n === 0) return null;
  const trip = tripOf(digest.nextTripOn, nowMs);
  const title =
    trip === 'tomorrow'
      ? `Courses demain${NBSP}: ${n} ${articles(n)}`
      : trip === 'today'
        ? `Courses${NBSP}: ${n} ${articles(n)} à racheter`
        : `${n} ${articles(n)} à racheter bientôt`;
  const segments: string[] = [];
  if (low.length) segments.push(`Sous le seuil${NBSP}: ${nameListPlus(low.map((p) => p.name))}`);
  if (soon.length) segments.push(`Bientôt épuisé${NBSP}: ${nameListPlus(soon.map((p) => p.name))}`);
  return {
    kind: 'digest',
    title: truncate(title, MAX_TITLE),
    body: truncate(segments.join(' · '), MAX_BODY),
    path: '/groceries',
    tag: `digest-${householdId}`,
    ttl: TTL_DIGEST,
    productIds: [...low.map((p) => p.id), ...soon.map((p) => p.id)],
  };
}

// --- Payload (§2.1) ---------------------------------------------------------------------------

export function buildPayload(
  copy: Copy,
  householdId: HouseholdId,
  outboxIds: number[],
  appUrl: string,
  nowMs: number,
): PushPayload {
  return {
    web_push: 8030,
    notification: {
      title: copy.title,
      body: copy.body,
      navigate: `${appUrl.replace(/\/+$/, '')}${copy.path}`,
      tag: copy.tag,
      lang: 'fr',
      dir: 'ltr',
      silent: false,
      data: {
        v: 1,
        kind: copy.kind,
        householdId,
        productIds: [...copy.productIds],
        path: copy.path,
        outboxIds: [...outboxIds],
        sentAt: new Date(nowMs).toISOString(),
      },
    },
  };
}

/**
 * UTF-8 JSON of the payload, kept under 3 000 bytes by dropping trailing `productIds`, then
 * trailing `outboxIds` (both diagnostic lists; a 50-product digest would otherwise exceed it).
 */
export function serializePayload(payload: PushPayload): Uint8Array {
  const enc = new TextEncoder();
  const data = payload.notification.data;
  let bytes = enc.encode(JSON.stringify(payload));
  while (bytes.length > MAX_PAYLOAD_BYTES && (data.productIds.length > 0 || data.outboxIds.length > 1)) {
    if (data.productIds.length > 0) data.productIds.pop();
    else data.outboxIds.pop();
    bytes = enc.encode(JSON.stringify(payload));
  }
  return bytes;
}
