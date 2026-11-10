import { assert, assertEquals } from '@std/assert';
import type { ClaimedItem, NotificationCompleteReport } from './contract.ts';
import { classify, DEFAULT_CONFIG, planRound, run, type OutgoingPush, type PushResponse } from './run.ts';

const H = 'aaaaaaaa-0000-4000-8000-000000000001';
const P = (n: number) => `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = Date.parse('2026-11-10T17:00:00Z');
const APP = 'https://cellier-one.vercel.app';

const sub = (id: string, host = 'web.push.apple.com') => ({
  id,
  endpoint: `https://${host}/secret-path-${id}`,
  p256dh: 'unused-by-fake-sender',
  auth: 'unused',
});

function low(outboxId: number, n: number, recipients: ClaimedItem['recipients'], name = `Produit${n}`): ClaimedItem {
  return {
    outboxId,
    kind: 'running_low',
    householdId: H,
    householdName: 'Maison Secrète',
    product: { id: P(n), name, totalQuantity: 1, minQuantity: 2 },
    digest: null,
    recipients,
  };
}

function digestItem(outboxId: number, recipients: ClaimedItem['recipients'], empty = false): ClaimedItem {
  return {
    outboxId,
    kind: 'digest',
    householdId: H,
    householdName: 'Maison Secrète',
    product: null,
    digest: {
      lowProducts: empty ? [] : [{ id: P(9), name: 'Lait', totalQuantity: 0 }],
      runningOutSoon: [],
      nextTripOn: '2026-11-11',
    },
    recipients,
  };
}

function harness(rounds: ClaimedItem[][], statusFor: (p: OutgoingPush) => number | null, opts: { clockStep?: number } = {}) {
  const reports: NotificationCompleteReport[] = [];
  const logs: Record<string, unknown>[] = [];
  const sent: OutgoingPush[] = [];
  let t = NOW;
  let inFlight = 0;
  let maxInFlight = 0;
  let r = 0;
  const deps = {
    store: {
      claim: () => Promise.resolve({ items: rounds[Math.min(r++, rounds.length - 1)] ?? [] }),
      complete: (rep: NotificationCompleteReport) => {
        reports.push(rep);
        return Promise.resolve();
      },
    },
    send: async (p: OutgoingPush): Promise<PushResponse> => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      sent.push(p);
      await new Promise((res) => setTimeout(res, 1));
      inFlight--;
      t += opts.clockStep ?? 0;
      return { status: statusFor(p), reason: null };
    },
    now: () => t,
    log: (l: Record<string, unknown>) => logs.push(l),
    config: { ...DEFAULT_CONFIG, appUrl: APP, executionId: 'exec-1' },
  };
  return { deps, reports, logs, sent, maxInFlight: () => maxInFlight };
}

const decode = (p: OutgoingPush) => JSON.parse(new TextDecoder().decode(p.payload));

Deno.test('classify', () => {
  assertEquals([200, 201, 202].map(classify), ['ok', 'ok', 'ok']);
  assertEquals([404, 410].map(classify), ['gone', 'gone']);
  assertEquals([429, 500, 503, null].map(classify), ['transient', 'transient', 'transient', 'transient']);
  assertEquals([400, 401, 403, 413].map(classify), ['sender_fault', 'sender_fault', 'sender_fault', 'sender_fault']);
});

Deno.test('single running-low item → one message per subscription, sent', async () => {
  const h = harness([[low(412, 1, [{ userId: 'u1', subscriptions: [sub('s1')] }], 'Pâtes')]], () => 201);
  await run(h.deps);
  assertEquals(h.sent.length, 1);
  const p = decode(h.sent[0]);
  assertEquals(p.notification.title, 'Pâtes : plus que 1');
  assertEquals(p.notification.navigate, `${APP}/items/${P(1)}`);
  assertEquals(h.sent[0].ttl, 43_200);
  assertEquals(h.sent[0].topic.length, 32);
  assertEquals(h.reports[0], { outbox: [{ outboxId: 412, status: 'sent', error: null }], subscriptions: [{ id: 's1', result: 'ok' }] });
});

Deno.test('three items, same household and recipient → one grouped message', async () => {
  const rec = [{ userId: 'u1', subscriptions: [sub('s1')] }];
  const h = harness([[low(1, 1, rec, 'Pâtes'), low(2, 2, rec, 'Lait'), low(3, 3, rec, 'Café')]], () => 201);
  await run(h.deps);
  assertEquals(h.sent.length, 1);
  const p = decode(h.sent[0]);
  assertEquals(p.notification.title, '3 articles à racheter');
  assertEquals(p.notification.body, 'Pâtes, Lait et Café');
  assertEquals(p.notification.data.path, '/groceries');
  assertEquals(p.notification.data.outboxIds, [1, 2, 3]);
  assertEquals(h.reports[0].outbox.map((o) => o.status), ['sent', 'sent', 'sent']);
});

Deno.test('skips: product gone, no recipient, empty digest', async () => {
  const gone = { ...low(1, 1, [{ userId: 'u1', subscriptions: [sub('s1')] }]), product: null };
  const h = harness([[gone, low(2, 2, []), digestItem(3, [{ userId: 'u1', subscriptions: [sub('s1')] }], true)]], () => 201);
  await run(h.deps);
  assertEquals(h.sent.length, 0);
  assertEquals(h.reports[0].outbox, [
    { outboxId: 1, status: 'skipped', error: 'product_gone' },
    { outboxId: 2, status: 'skipped', error: 'no_recipient' },
    { outboxId: 3, status: 'skipped', error: 'empty_digest' },
  ]);
});

Deno.test('404/410 → gone; all_gone when every subscription is gone', async () => {
  const h = harness([[low(1, 1, [{ userId: 'u1', subscriptions: [sub('s1'), sub('s2')] }])]], (p) =>
    p.subscription.id === 's1' ? 410 : 404,
  );
  await run(h.deps);
  assertEquals(h.reports[0].outbox, [{ outboxId: 1, status: 'skipped', error: 'all_gone' }]);
  assertEquals(h.reports[0].subscriptions, [
    { id: 's1', result: 'gone' },
    { id: 's2', result: 'gone' },
  ]);
});

Deno.test('transient only → retry, subscription error', async () => {
  const h = harness([[low(1, 1, [{ userId: 'u1', subscriptions: [sub('s1'), sub('s2')] }])]], (p) =>
    p.subscription.id === 's1' ? 500 : null,
  );
  await run(h.deps);
  assertEquals(h.reports[0].outbox[0].status, 'retry');
  assertEquals(h.reports[0].subscriptions.map((s) => s.result), ['error', 'error']);
});

Deno.test('one ok among failures → sent', async () => {
  const h = harness([[low(1, 1, [{ userId: 'u1', subscriptions: [sub('s1'), sub('s2')] }])]], (p) =>
    p.subscription.id === 's1' ? 201 : 429,
  );
  await run(h.deps);
  assertEquals(h.reports[0].outbox[0].status, 'sent');
});

Deno.test('403 → failed sender_fault_403, subscription omitted, error logged', async () => {
  const h = harness([[low(1, 1, [{ userId: 'u1', subscriptions: [sub('s1')] }])]], () => 403);
  await run(h.deps);
  assertEquals(h.reports[0], { outbox: [{ outboxId: 1, status: 'failed', error: 'sender_fault_403' }], subscriptions: [] });
  const line = h.logs.find((l) => l.event === 'push_failed');
  assertEquals(line?.level, 'error');
  assertEquals(line?.host, 'web.push.apple.com');
});

Deno.test('subscription receiving a group and a digest, one gone → reported once as gone', async () => {
  const rec = [{ userId: 'u1', subscriptions: [sub('s1')] }];
  let n = 0;
  const h = harness([[low(1, 1, rec), low(2, 2, rec), digestItem(3, rec)]], () => (n++ === 0 ? 201 : 410));
  await run(h.deps);
  assertEquals(h.sent.length, 2);
  assertEquals(h.reports[0].subscriptions, [{ id: 's1', result: 'gone' }]);
  const digest = h.sent.find((p) => decode(p).notification.data.kind === 'digest');
  assert(digest);
  assertEquals(digest.ttl, 14_400);
});

Deno.test('loop stops on budget, concurrency bounded', async () => {
  const full = Array.from({ length: 50 }, (_, i) => low(i + 1, i + 1, [{ userId: `u${i}`, subscriptions: [sub(`s${i}`)] }]));
  const h = harness([full], () => 201, { clockStep: 100 });
  const stats = await run(h.deps);
  // 50 sends × 100 ms = 5 s per round → stops after the round that crosses 20 s.
  assertEquals(stats.rounds, 4);
  assertEquals(stats.event, 'deadline');
  assert(h.maxInFlight() <= DEFAULT_CONFIG.concurrency);
  assert(h.maxInFlight() > 1);
});

Deno.test('loop stops after a short claim', async () => {
  const h = harness([[low(1, 1, [{ userId: 'u1', subscriptions: [sub('s1')] }])], []], () => 201);
  const stats = await run(h.deps);
  assertEquals(stats.rounds, 1);
  assertEquals(stats.event, 'done');
});

Deno.test('logs contain no endpoint path, key, product or household name', async () => {
  const h = harness(
    [[low(1, 1, [{ userId: 'u1', subscriptions: [sub('s1'), sub('s2')] }], 'Pâtes'), digestItem(2, [{ userId: 'u1', subscriptions: [sub('s1')] }])]],
    (p) => (p.subscription.id === 's1' ? 410 : 500),
  );
  await run(h.deps);
  const text = JSON.stringify(h.logs);
  for (const bad of ['secret-path', 'Pâtes', 'Lait', 'Maison', 'p256dh', 'unused']) assert(!text.includes(bad), bad);
  assert(h.logs.some((l) => l.fn === 'send-push' && l.event === 'done'));
});

Deno.test('planRound: same product claimed twice for a recipient is named once', async () => {
  const rec = [{ userId: 'u1', subscriptions: [sub('s1')] }];
  const plan = await planRound([low(1, 1, rec, 'Pâtes'), low(2, 1, rec, 'Pâtes')], APP, NOW);
  assertEquals(plan.messages.length, 1);
  assertEquals(plan.messages[0].outboxIds, [1, 2]);
  assertEquals(plan.messages[0].copy.title, 'Pâtes : plus que 1');
});
