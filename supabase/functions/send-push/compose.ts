/**
 * Copy and payload composition (§2.1, §2.3, §3.6, §4). Pure functions, no I/O. Every message is
 * written in its recipient's language (French, English or Swedish; French when unknown).
 * Typography: U+00A0 before «:» in French, typographic apostrophe ’, single-character ellipsis ….
 */

import type {
  ClaimedDigest,
  ClaimedProduct,
  HouseholdId,
  NotificationKind,
  NotificationLang,
  NotificationPath,
  NotificationTag,
  ProductId,
  PushPayload,
} from './contract.ts';

export const NBSP = '\u00a0';
export const MAX_NAME = 40;
export const MAX_TITLE = 60;
export const MAX_BODY = 180;
export const MAX_PAYLOAD_BYTES = 3000;
export const TTL_RUNNING_LOW = 43_200;
export const TTL_DIGEST = 14_400;
export const RUNNING_LOW_BODY = 'Seuil d’alerte atteint. Ajout automatique à Courses.';

export const DEFAULT_LANG: NotificationLang = 'fr';

/** The recipient's saved language (`cellier_locale` in the account's metadata), French when unset or unknown. */
export function langOf(value: unknown): NotificationLang {
  return value === 'en' || value === 'sv' || value === 'fr' ? value : DEFAULT_LANG;
}

/** Everything a notification says, per language. Mirrors the app's vocabulary (src/shared/i18n). */
interface Strings {
  intl: string;
  /** Name of a product whose name is empty. */
  unnamed: string;
  left: (name: string, quantity: string) => string;
  out: (name: string) => string;
  runningLowBody: string;
  /** Title of several running-low products grouped in one notification. */
  severalLow: (n: number) => string;
  and: string;
  others: (n: number) => string;
  digestTomorrow: (n: number) => string;
  digestToday: (n: number) => string;
  digestSoon: (n: number) => string;
  belowLevel: string;
  runningOut: string;
}

const articles = (n: number) => (n === 1 ? 'article' : 'articles');
const items = (n: number) => (n === 1 ? 'item' : 'items');
const varor = (n: number) => (n === 1 ? 'vara' : 'varor');

const STRINGS: Record<NotificationLang, Strings> = {
  fr: {
    intl: 'fr-FR',
    unnamed: 'Article',
    left: (name, quantity) => `${name}${NBSP}: plus que ${quantity}`,
    out: (name) => `${name}${NBSP}: stock épuisé`,
    runningLowBody: RUNNING_LOW_BODY,
    severalLow: (n) => `${n} articles à racheter`,
    and: 'et',
    others: (n) => `${n} ${n === 1 ? 'autre' : 'autres'}`,
    digestTomorrow: (n) => `Courses demain${NBSP}: ${n} ${articles(n)}`,
    digestToday: (n) => `Courses${NBSP}: ${n} ${articles(n)} à racheter`,
    digestSoon: (n) => `${n} ${articles(n)} à racheter bientôt`,
    belowLevel: `Sous le seuil${NBSP}:`,
    runningOut: `Bientôt épuisé${NBSP}:`,
  },
  en: {
    intl: 'en-GB',
    unnamed: 'Item',
    left: (name, quantity) => `${name}: only ${quantity} left`,
    out: (name) => `${name}: out of stock`,
    runningLowBody: 'Below its alert level. Added to your shopping list.',
    severalLow: (n) => `${n} items running low`,
    and: 'and',
    others: (n) => `${n} ${n === 1 ? 'other' : 'others'}`,
    digestTomorrow: (n) => `Shopping tomorrow: ${n} ${items(n)}`,
    digestToday: (n) => `Shopping today: ${n} ${items(n)} to buy`,
    digestSoon: (n) => `${n} ${items(n)} to buy soon`,
    belowLevel: 'Below alert level:',
    runningOut: 'Running out soon:',
  },
  sv: {
    intl: 'sv-SE',
    unnamed: 'Vara',
    left: (name, quantity) => `${name}: bara ${quantity} kvar`,
    out: (name) => `${name}: slut`,
    runningLowBody: 'Varningsnivån är nådd. Tillagd på inköpslistan.',
    severalLow: (n) => `${n} varor är snart slut`,
    and: 'och',
    others: (n) => `${n} till`,
    digestTomorrow: (n) => `Inköp i morgon: ${n} ${varor(n)}`,
    digestToday: (n) => `Inköp i dag: ${n} ${varor(n)} att köpa`,
    digestSoon: (n) => `${n} ${varor(n)} att köpa snart`,
    belowLevel: 'Under varningsnivån:',
    runningOut: 'Snart slut:',
  },
};

const collators = new Map<NotificationLang, Intl.Collator>();
const quantityFormats = new Map<NotificationLang, Intl.NumberFormat>();

function collator(lang: NotificationLang): Intl.Collator {
  let c = collators.get(lang);
  if (!c) {
    c = new Intl.Collator(STRINGS[lang].intl, { sensitivity: 'base', numeric: true });
    collators.set(lang, c);
  }
  return c;
}

function formatQuantity(quantity: number, lang: NotificationLang): string {
  let f = quantityFormats.get(lang);
  if (!f) {
    f = new Intl.NumberFormat(STRINGS[lang].intl, { maximumFractionDigits: 2 });
    quantityFormats.set(lang, f);
  }
  return f.format(quantity);
}

/** Cuts to `max` code points, the last one being «…» when cut. */
export function truncate(s: string, max: number): string {
  const chars = Array.from(s);
  return chars.length <= max ? s : `${chars.slice(0, max - 1).join('').trimEnd()}…`;
}

export function productName(name: string, lang: NotificationLang = DEFAULT_LANG): string {
  const t = name.trim().replace(/\s+/g, ' ');
  return truncate(t || STRINGS[lang].unnamed, MAX_NAME);
}

/** «A», «A et B», «A, B et C», «A, B, C et 1 autre», «A, B, C et 2 autres» (§3.6). */
export function nameListEt(names: string[], lang: NotificationLang = DEFAULT_LANG): string {
  const { and, others } = STRINGS[lang];
  const shown = names.slice(0, 3).map((n) => productName(n, lang));
  const rest = names.length - shown.length;
  if (rest > 0) return `${shown.join(', ')} ${and} ${others(rest)}`;
  if (shown.length <= 1) return shown.join('');
  return `${shown.slice(0, -1).join(', ')} ${and} ${shown[shown.length - 1]}`;
}

/** «A, B, C +2» (§4). */
export function nameListPlus(names: string[], lang: NotificationLang = DEFAULT_LANG): string {
  const shown = names
    .slice(0, 3)
    .map((n) => productName(n, lang))
    .join(', ');
  const rest = names.length - 3;
  return rest > 0 ? `${shown} +${rest}` : shown;
}

/** A composed message, before payload serialisation. */
export interface Copy {
  kind: NotificationKind;
  lang: NotificationLang;
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

export function composeRunningLow(
  householdId: HouseholdId,
  products: ClaimedProduct[],
  lang: NotificationLang = DEFAULT_LANG,
): Copy {
  const strings = STRINGS[lang];
  if (products.length === 1) {
    const p = products[0];
    const name = productName(p.name, lang);
    const title =
      p.totalQuantity > 0 ? strings.left(name, formatQuantity(p.totalQuantity, lang)) : strings.out(name);
    return {
      kind: 'running_low',
      lang,
      title: truncate(title, MAX_TITLE),
      body: strings.runningLowBody,
      path: `/items/${p.id}`,
      tag: `produit-${p.id}`,
      ttl: TTL_RUNNING_LOW,
      productIds: [p.id],
    };
  }
  return {
    kind: 'running_low',
    lang,
    title: truncate(strings.severalLow(products.length), MAX_TITLE),
    body: truncate(nameListEt(products.map((p) => p.name), lang), MAX_BODY),
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

export function digestLists(digest: ClaimedDigest, nowMs: number, lang: NotificationLang = DEFAULT_LANG) {
  const low = [...(digest.lowProducts ?? [])].sort(
    (a, b) => a.totalQuantity - b.totalQuantity || collator(lang).compare(a.name, b.name),
  );
  const lowIds = new Set(low.map((p) => p.id));
  const soon = (digest.runningOutSoon ?? [])
    .map((p) => ({ ...p, t: Date.parse(p.runOutAt) }))
    .filter((p) => !lowIds.has(p.id) && Number.isFinite(p.t) && p.t >= nowMs - STALE_MS)
    .sort((a, b) => a.t - b.t);
  return { low, soon };
}

/** Returns null when there is nothing to report (item skipped with `empty_digest`). */
export function composeDigest(
  householdId: HouseholdId,
  digest: ClaimedDigest,
  nowMs: number,
  lang: NotificationLang = DEFAULT_LANG,
): Copy | null {
  const strings = STRINGS[lang];
  const { low, soon } = digestLists(digest, nowMs, lang);
  const n = low.length + soon.length;
  if (n === 0) return null;
  const trip = tripOf(digest.nextTripOn, nowMs);
  const title =
    trip === 'tomorrow' ? strings.digestTomorrow(n) : trip === 'today' ? strings.digestToday(n) : strings.digestSoon(n);
  const segments: string[] = [];
  if (low.length) segments.push(`${strings.belowLevel} ${nameListPlus(low.map((p) => p.name), lang)}`);
  if (soon.length) segments.push(`${strings.runningOut} ${nameListPlus(soon.map((p) => p.name), lang)}`);
  return {
    kind: 'digest',
    lang,
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
      lang: copy.lang,
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
