/**
 * The send loop (§3.5 run(), §3.6 grouping, §3.7 outcomes). I/O is injected so tests can use a
 * fake store, a fake sender and a fake clock.
 */

import {
  buildPayload,
  composeDigest,
  composeRunningLow,
  runningLowSkipReason,
  serializePayload,
  type Copy,
} from './compose.ts';
import type {
  ClaimedItem,
  ClaimedProduct,
  ClaimedSubscription,
  NotificationClaimResult,
  NotificationCompleteReport,
  NotificationKind,
  OutboxReport,
  SendPushInvocationLog,
  SubscriptionReport,
} from './contract.ts';
import { topicFromTag } from './webpush.ts';

// --- Dependencies -----------------------------------------------------------------------------

export interface NotificationStore {
  claim(limit: number): Promise<NotificationClaimResult>;
  complete(report: NotificationCompleteReport): Promise<void>;
}

export interface OutgoingPush {
  subscription: ClaimedSubscription;
  /** UTF-8 JSON of the PushPayload (plaintext, encrypted by the sender). */
  payload: Uint8Array;
  ttl: number;
  urgency: 'normal';
  topic: string;
}

/** `status` null means a network error or timeout. `reason` is Apple's JSON `reason`, if any. */
export interface PushResponse {
  status: number | null;
  reason?: string | null;
}

export type Sender = (push: OutgoingPush) => Promise<PushResponse>;
export type Logger = (line: Record<string, unknown>) => void;

export interface RunConfig {
  appUrl: string;
  batchSize: number;
  /** No new round starts after this many ms since start. */
  budgetMs: number;
  /** No new round starts after this many push requests. */
  maxRequests: number;
  concurrency: number;
  executionId: string | null;
}

export const DEFAULT_CONFIG: Omit<RunConfig, 'appUrl' | 'executionId'> = {
  batchSize: 50,
  budgetMs: 20_000,
  maxRequests: 300,
  concurrency: 6,
};

export interface RunDeps {
  store: NotificationStore;
  send: Sender;
  now: () => number;
  log: Logger;
  config: RunConfig;
}

// --- Planning (§3.6) --------------------------------------------------------------------------

export interface PlannedMessage {
  kind: NotificationKind;
  outboxIds: number[];
  copy: Copy;
  payload: Uint8Array;
  topic: string;
  subscriptions: ClaimedSubscription[];
}

export interface Plan {
  messages: PlannedMessage[];
  skipped: OutboxReport[];
}

export async function planRound(items: ClaimedItem[], appUrl: string, nowMs: number): Promise<Plan> {
  const skipped: OutboxReport[] = [];
  const drafts: { copy: Copy; householdId: string; outboxIds: number[]; subscriptions: ClaimedSubscription[] }[] = [];

  // running_low: household → recipient → items (claim order).
  const groups = new Map<
    string,
    { householdId: string; items: { outboxId: number; product: ClaimedProduct }[]; subs: Map<string, ClaimedSubscription> }
  >();

  for (const item of items) {
    const recipients = (item.recipients ?? []).filter((r) => r.subscriptions?.length);
    if (item.kind === 'running_low') {
      const skip = runningLowSkipReason(item.product);
      const product = item.product;
      if (skip || !product) {
        skipped.push({ outboxId: item.outboxId, status: 'skipped', error: skip ?? 'product_gone' });
        continue;
      }
      if (recipients.length === 0) {
        skipped.push({ outboxId: item.outboxId, status: 'skipped', error: 'no_recipient' });
        continue;
      }
      for (const r of recipients) {
        const key = `${item.householdId}\u0000${r.userId}`;
        let g = groups.get(key);
        if (!g) {
          g = { householdId: item.householdId, items: [], subs: new Map() };
          groups.set(key, g);
        }
        if (!g.items.some((x) => x.outboxId === item.outboxId)) g.items.push({ outboxId: item.outboxId, product });
        for (const s of r.subscriptions) g.subs.set(s.id, s);
      }
    } else if (item.kind === 'digest') {
      if (recipients.length === 0) {
        skipped.push({ outboxId: item.outboxId, status: 'skipped', error: 'no_recipient' });
        continue;
      }
      const copy = item.digest ? composeDigest(item.householdId, item.digest, nowMs) : null;
      if (!copy) {
        skipped.push({ outboxId: item.outboxId, status: 'skipped', error: 'empty_digest' });
        continue;
      }
      for (const r of recipients) {
        drafts.push({ copy, householdId: item.householdId, outboxIds: [item.outboxId], subscriptions: r.subscriptions });
      }
    } else {
      skipped.push({ outboxId: (item as ClaimedItem).outboxId, status: 'failed', error: 'unknown_kind' });
    }
  }

  for (const g of groups.values()) {
    // Two outbox rows for the same product (unlikely) collapse into one name in the copy.
    const products: ClaimedProduct[] = [];
    for (const x of g.items) if (!products.some((p) => p.id === x.product.id)) products.push(x.product);
    drafts.push({
      copy: composeRunningLow(g.householdId, products),
      householdId: g.householdId,
      outboxIds: g.items.map((x) => x.outboxId),
      subscriptions: [...g.subs.values()],
    });
  }

  const messages: PlannedMessage[] = [];
  for (const d of drafts) {
    const payload = serializePayload(buildPayload(d.copy, d.householdId, d.outboxIds, appUrl, nowMs));
    messages.push({
      kind: d.copy.kind,
      outboxIds: d.outboxIds,
      copy: d.copy,
      payload,
      topic: await topicFromTag(d.copy.tag),
      subscriptions: d.subscriptions,
    });
  }
  return { messages, skipped };
}

// --- Outcomes (§3.7) --------------------------------------------------------------------------

export type Outcome = 'ok' | 'gone' | 'transient' | 'sender_fault';

export function classify(status: number | null): Outcome {
  if (status === null) return 'transient';
  if (status === 200 || status === 201 || status === 202) return 'ok';
  if (status === 404 || status === 410) return 'gone';
  if (status === 408 || status === 429 || status >= 500) return 'transient';
  return 'sender_fault';
}

export interface Delivery {
  message: PlannedMessage;
  subscriptionId: string;
  status: number | null;
  outcome: Outcome;
}

export function buildReport(plan: Plan, deliveries: Delivery[]): NotificationCompleteReport {
  // Subscriptions: gone > ok > error; only sender faults → omitted.
  const subs = new Map<string, Set<Outcome>>();
  for (const d of deliveries) {
    const s = subs.get(d.subscriptionId) ?? new Set<Outcome>();
    s.add(d.outcome);
    subs.set(d.subscriptionId, s);
  }
  const subscriptions: SubscriptionReport[] = [];
  for (const [id, set] of subs) {
    if (set.has('gone')) subscriptions.push({ id, result: 'gone' });
    else if (set.has('ok')) subscriptions.push({ id, result: 'ok' });
    else if (set.has('transient')) subscriptions.push({ id, result: 'error' });
  }

  // Items: per outbox id, every delivery of every message naming it.
  const byItem = new Map<number, Delivery[]>();
  for (const m of plan.messages) for (const id of m.outboxIds) if (!byItem.has(id)) byItem.set(id, []);
  for (const d of deliveries) for (const id of d.message.outboxIds) byItem.get(id)?.push(d);

  const outbox: OutboxReport[] = [...plan.skipped];
  for (const [outboxId, ds] of byItem) {
    if (ds.some((d) => d.outcome === 'ok')) {
      outbox.push({ outboxId, status: 'sent', error: null });
      continue;
    }
    const transient = ds.find((d) => d.outcome === 'transient');
    if (transient) {
      outbox.push({ outboxId, status: 'retry', error: transient.status === null ? 'transient_network' : `transient_${transient.status}` });
      continue;
    }
    const fault = ds.find((d) => d.outcome === 'sender_fault');
    if (fault) {
      outbox.push({ outboxId, status: 'failed', error: `sender_fault_${fault.status}` });
      continue;
    }
    if (ds.length > 0) outbox.push({ outboxId, status: 'skipped', error: 'all_gone' });
    else outbox.push({ outboxId, status: 'failed', error: 'no_delivery' });
  }
  return { outbox, subscriptions };
}

// --- Pool -------------------------------------------------------------------------------------

export async function pool<T, R>(inputs: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(inputs.length);
  let next = 0;
  const lane = async () => {
    while (next < inputs.length) {
      const i = next++;
      out[i] = await fn(inputs[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), inputs.length) }, lane));
  return out;
}

// --- run() ------------------------------------------------------------------------------------

export function emptyStats(executionId: string | null): SendPushInvocationLog {
  return {
    fn: 'send-push',
    event: 'done',
    executionId,
    rounds: 0,
    claimed: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    retried: 0,
    messages: 0,
    subsOk: 0,
    subsGone: 0,
    subsError: 0,
    senderFaults: 0,
    ms: 0,
  };
}

function hostOf(endpoint: string): string | null {
  try {
    return new URL(endpoint).host;
  } catch {
    return null;
  }
}

/** Runs claim → plan → send → complete rounds. `stats` is updated in place (read by the shutdown log). */
export async function run(deps: RunDeps, stats = emptyStats(deps.config.executionId)): Promise<SendPushInvocationLog> {
  const { store, send, now, log, config } = deps;
  const start = now();
  let requests = 0;
  try {
    for (;;) {
      const claim = await store.claim(config.batchSize);
      const items = claim?.items ?? [];
      if (items.length === 0) break;
      stats.rounds++;
      stats.claimed += items.length;

      const plan = await planRound(items, config.appUrl, now());
      stats.messages += plan.messages.length;
      const tasks = plan.messages.flatMap((message) => message.subscriptions.map((subscription) => ({ message, subscription })));
      requests += tasks.length;

      const deliveries = await pool(tasks, config.concurrency, async ({ message, subscription }): Promise<Delivery> => {
        let res: PushResponse;
        try {
          res = await send({ subscription, payload: message.payload, ttl: message.copy.ttl, urgency: 'normal', topic: message.topic });
        } catch {
          res = { status: null };
        }
        const outcome = classify(res.status);
        if (outcome !== 'ok') {
          const line = {
            fn: 'send-push',
            event: 'push_failed',
            level: outcome === 'sender_fault' ? 'error' : 'warn',
            outboxIds: message.outboxIds,
            kind: message.kind,
            status: res.status,
            reason: res.reason ?? null,
            host: hostOf(subscription.endpoint),
          };
          log(line);
        }
        return { message, subscriptionId: subscription.id, status: res.status, outcome };
      });

      const report = buildReport(plan, deliveries);
      for (const o of report.outbox) {
        if (o.status === 'sent') stats.sent++;
        else if (o.status === 'skipped') stats.skipped++;
        else if (o.status === 'failed') stats.failed++;
        else stats.retried++;
      }
      for (const s of report.subscriptions) {
        if (s.result === 'ok') stats.subsOk++;
        else if (s.result === 'gone') stats.subsGone++;
        else stats.subsError++;
      }
      stats.senderFaults += deliveries.filter((d) => d.outcome === 'sender_fault').length;

      await store.complete(report);

      if (items.length < config.batchSize) break;
      if (now() - start >= config.budgetMs || requests >= config.maxRequests) {
        stats.event = 'deadline';
        break;
      }
    }
  } catch (e) {
    stats.event = 'error';
    log({ fn: 'send-push', event: 'run_error', level: 'error', error: e instanceof Error ? e.message.slice(0, 200) : 'unknown' });
  }
  stats.ms = now() - start;
  log({ ...stats, level: stats.event === 'error' ? 'error' : 'info' });
  return stats;
}
