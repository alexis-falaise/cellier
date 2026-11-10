export interface DuplicateFilterOptions {
  /** The same code is ignored for this long after it was emitted. */
  repeatMs?: number;
  /** ...and until it has been out of sight for this long. */
  clearMs?: number;
}

interface Seen {
  emittedAt: number;
  lastSeenAt: number;
  cleared: boolean;
}

export interface DuplicateFilter {
  /** Records a sighting of `key` at `now` (ms) and says whether to emit it. */
  accept(key: string, now: number): boolean;
  reset(): void;
}

/** Design 4.4.4: same code ignored for 1.5 s and until it has left the frame for 300 ms. */
export function createDuplicateFilter({
  repeatMs = 1500,
  clearMs = 300,
}: DuplicateFilterOptions = {}): DuplicateFilter {
  const seen = new Map<string, Seen>();
  const forgetAfter = Math.max(repeatMs, clearMs);

  return {
    accept(key, now) {
      for (const [k, s] of seen) {
        if (now - s.lastSeenAt > forgetAfter && now - s.emittedAt >= repeatMs) seen.delete(k);
      }
      const s = seen.get(key);
      if (!s) {
        seen.set(key, { emittedAt: now, lastSeenAt: now, cleared: false });
        return true;
      }
      if (now - s.lastSeenAt >= clearMs) s.cleared = true;
      s.lastSeenAt = now;
      if (s.cleared && now - s.emittedAt >= repeatMs) {
        s.emittedAt = now;
        s.cleared = false;
        return true;
      }
      return false;
    },
    reset() {
      seen.clear();
    },
  };
}
