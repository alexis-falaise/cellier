import { describe, expect, it } from 'vitest';
import { createDuplicateFilter } from './dedupe';

/** Sightings every `every` ms from `from` to `to` inclusive; returns the times that were accepted. */
function hold(filter: ReturnType<typeof createDuplicateFilter>, key: string, from: number, to: number, every = 100) {
  const accepted: number[] = [];
  for (let t = from; t <= to; t += every) if (filter.accept(key, t)) accepted.push(t);
  return accepted;
}

describe('createDuplicateFilter', () => {
  it('emits a new code at once', () => {
    const f = createDuplicateFilter();
    expect(f.accept('A', 0)).toBe(true);
  });

  it('never re-emits a code held continuously in the frame', () => {
    const f = createDuplicateFilter();
    expect(hold(f, 'A', 0, 10_000)).toEqual([0]);
  });

  it('re-emits after 1.5 s once the code has left the frame for 300 ms', () => {
    const f = createDuplicateFilter();
    expect(f.accept('A', 0)).toBe(true);
    // Away from 0 to 1600, back at 1600.
    expect(f.accept('A', 1600)).toBe(true);
  });

  it('ignores a return before 1.5 s, then accepts it at 1.5 s without another exit', () => {
    const f = createDuplicateFilter();
    f.accept('A', 0);
    // Left at 0, back at 500 (gap 500 ≥ 300) and held there.
    expect(hold(f, 'A', 500, 2000)).toEqual([1500]);
  });

  it('does not count a gap shorter than 300 ms as leaving the frame', () => {
    const f = createDuplicateFilter();
    f.accept('A', 0);
    const times = [250, 500, 750, 1000, 1250, 1500, 1750, 2000];
    expect(times.filter((t) => f.accept('A', t))).toEqual([]);
  });

  it('handles several codes independently', () => {
    const f = createDuplicateFilter();
    expect(f.accept('A', 0)).toBe(true);
    expect(f.accept('B', 50)).toBe(true);
    expect(f.accept('A', 100)).toBe(false);
    expect(f.accept('B', 2000)).toBe(true);
    expect(f.accept('A', 2000)).toBe(true);
  });

  it('two identical items scanned one after the other count twice', () => {
    const f = createDuplicateFilter();
    const first = hold(f, 'yaourt', 0, 800);
    // Item swapped: 400 ms with nothing in frame, second item held.
    const second = hold(f, 'yaourt', 1200, 2600);
    expect(first).toEqual([0]);
    expect(second).toEqual([1500]);
  });

  it('honours custom windows', () => {
    const f = createDuplicateFilter({ repeatMs: 500, clearMs: 100 });
    f.accept('A', 0);
    expect(f.accept('A', 200)).toBe(false);
    expect(f.accept('A', 500)).toBe(true);
  });

  it('forgets everything on reset', () => {
    const f = createDuplicateFilter();
    f.accept('A', 0);
    f.reset();
    expect(f.accept('A', 10)).toBe(true);
  });

  it('prunes old entries without changing the outcome', () => {
    const f = createDuplicateFilter();
    for (let i = 0; i < 1000; i++) f.accept(`code-${i}`, i * 10);
    expect(f.accept('code-0', 20_000)).toBe(true);
  });
});
