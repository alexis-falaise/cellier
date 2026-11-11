import { describe, expect, it } from 'vitest';
import { createDuplicateFilter, type DuplicateFilter, digitDistance } from './dedupe';

type Timeline = (t: number) => string[];

/** Feeds one decoded frame every `every` ms from `from` to `to` inclusive; returns [time, key] for each emission. */
function run(filter: DuplicateFilter, timeline: Timeline, from: number, to: number, every = 100) {
  const out: [number, string][] = [];
  for (let t = from; t <= to; t += every) for (const key of filter.frame(timeline(t), t)) out.push([t, key]);
  return out;
}

const A = '03017620422003';
const A_MISREAD = '03017620422089'; // two digits away
const B = '05449000000996';

describe('createDuplicateFilter', () => {
  it('emits a new code on its second read', () => {
    const f = createDuplicateFilter();
    expect(f.frame([A], 0)).toEqual([]);
    expect(f.frame([A], 100)).toEqual([A]);
  });

  it('never emits a lone read', () => {
    const f = createDuplicateFilter();
    expect(run(f, (t) => (t === 300 ? [A] : []), 0, 3000)).toEqual([]);
  });

  it('never re-emits a code held continuously in the frame', () => {
    const f = createDuplicateFilter();
    expect(run(f, () => [A], 0, 10_000)).toEqual([[100, A]]);
  });

  it('a slow or flaky decoder does not re-log a code that never left', () => {
    const f = createDuplicateFilter();
    // Read on one decoded frame in four (400 ms gaps), the others come back empty.
    expect(run(f, (t) => (t % 400 === 0 ? [A] : []), 0, 10_000)).toEqual([[400, A]]);
  });

  it('a gap shorter than 800 ms does not count as leaving the frame', () => {
    const f = createDuplicateFilter();
    expect(run(f, (t) => (t >= 1000 && t < 1600 ? [] : [A]), 0, 6000)).toEqual([[100, A]]);
  });

  it('two identical items scanned one after the other count twice, 2 s apart at least', () => {
    const f = createDuplicateFilter();
    // First item to 800, nothing in frame to 1800, second item held.
    const out = run(f, (t) => (t <= 800 || t >= 1800 ? [A] : []), 0, 4000);
    expect(out).toEqual([
      [100, A],
      [2100, A],
    ]);
  });

  it('ignores a near-identical code while its neighbour is under the reticle', () => {
    const f = createDuplicateFilter();
    const out = run(f, (t) => (t >= 500 && t <= 900 ? [A, A_MISREAD] : [A]), 0, 3000);
    expect(out).toEqual([[100, A]]);
  });

  it('accepts a sibling product (close digits) once the first has left', () => {
    const f = createDuplicateFilter();
    const out = run(f, (t) => (t <= 1000 ? [A] : t >= 1200 ? [A_MISREAD] : []), 0, 3000);
    expect(out).toEqual([
      [100, A],
      [1700, A_MISREAD],
    ]);
  });

  it('accepts a different product straight away', () => {
    const f = createDuplicateFilter();
    const out = run(f, (t) => (t <= 1000 ? [A] : [B]), 0, 3000);
    expect(out).toEqual([
      [100, A],
      [1200, B],
    ]);
  });

  it('honours custom windows', () => {
    const f = createDuplicateFilter({ confirmFrames: 1, repeatMs: 500, clearMs: 100, clearFrames: 1 });
    expect(f.frame([A], 0)).toEqual([A]);
    expect(f.frame([], 150)).toEqual([]);
    expect(f.frame([A], 300)).toEqual([]);
    expect(f.frame([A], 500)).toEqual([A]);
  });

  it('forgets everything on reset', () => {
    const f = createDuplicateFilter({ confirmFrames: 1 });
    f.frame([A], 0);
    f.reset();
    expect(f.frame([A], 10)).toEqual([A]);
  });

  it('prunes old entries without changing the outcome', () => {
    const f = createDuplicateFilter({ confirmFrames: 1 });
    for (let i = 0; i < 1000; i++) f.frame([`code-${i}`], i * 10);
    for (let t = 10_000; t < 20_000; t += 100) f.frame([], t);
    expect(f.frame(['code-0'], 20_000)).toEqual(['code-0']);
  });
});

describe('digitDistance', () => {
  it('counts differing positions', () => {
    expect(digitDistance(A, A)).toBe(0);
    expect(digitDistance(A, A_MISREAD)).toBe(2);
    expect(digitDistance('123', '1234')).toBe(Number.POSITIVE_INFINITY);
  });
});
