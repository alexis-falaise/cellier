export interface DuplicateFilterOptions {
  /** A code is emitted once it has been read in this many decoded frames... */
  confirmFrames?: number;
  /** ...all within this window (ms). Checksum-valid misreads almost never repeat identically. */
  confirmMs?: number;
  /** The same code is not emitted again for this long after it was emitted. */
  repeatMs?: number;
  /** ...nor until it has been missing from the decoded frames for this long... */
  clearMs?: number;
  /** ...and from at least this many consecutive decoded frames (a slow decoder cannot fake an exit). */
  clearFrames?: number;
  /**
   * A code that differs from an emitted code by at most `similarDigits` digits is held back while that code was read
   * less than `similarMs` ago: it is a misread of the code under the reticle, not a second product.
   */
  similarDigits?: number;
  similarMs?: number;
}

interface Seen {
  /** Read times within the confirmation window, oldest first. */
  reads: number[];
  lastSeenAt: number;
  /** Consecutive decoded frames without this code. */
  missedFrames: number;
  emittedAt: number | null;
  /** Left the frame since it was emitted. */
  cleared: boolean;
}

export interface DuplicateFilter {
  /**
   * Feeds every decoded frame, including frames with no code, and returns the keys to emit. Absence is measured in
   * decoded frames, so a code is only considered gone once the decoder has actually looked and not found it.
   */
  frame(keys: readonly string[], now: number): string[];
  reset(): void;
}

/** Number of differing positions, or Infinity for different lengths. */
export function digitDistance(a: string, b: string): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

/**
 * Design 4.4.4, tightened: a code needs two matching reads; the same code is emitted again only after 2 s and once it
 * has left the frame for 800 ms; a code one or two digits away from an emitted code is ignored while that code was
 * read in the last 700 ms.
 */
export function createDuplicateFilter({
  confirmFrames = 2,
  confirmMs = 1000,
  repeatMs = 2000,
  clearMs = 800,
  clearFrames = 3,
  similarDigits = 2,
  similarMs = 700,
}: DuplicateFilterOptions = {}): DuplicateFilter {
  const seen = new Map<string, Seen>();
  const forgetAfter = Math.max(repeatMs, clearMs, similarMs, confirmMs);

  const isMisreadOf = (key: string, now: number): boolean => {
    for (const [other, s] of seen) {
      if (other === key || s.emittedAt === null || now - s.lastSeenAt >= similarMs) continue;
      if (digitDistance(key, other) <= similarDigits) return true;
    }
    return false;
  };

  return {
    frame(keys, now) {
      const present = new Set(keys);

      for (const [k, s] of seen) {
        if (present.has(k)) continue;
        s.missedFrames += 1;
        if (s.emittedAt !== null && s.missedFrames >= clearFrames && now - s.lastSeenAt >= clearMs) s.cleared = true;
        const idle = now - s.lastSeenAt > forgetAfter;
        if (idle && (s.emittedAt === null || now - s.emittedAt >= repeatMs)) seen.delete(k);
      }

      const out: string[] = [];
      for (const key of present) {
        let s = seen.get(key);
        if (!s) {
          s = { reads: [], lastSeenAt: now, missedFrames: 0, emittedAt: null, cleared: false };
          seen.set(key, s);
        }
        s.lastSeenAt = now;
        s.missedFrames = 0;
        s.reads.push(now);
        while (s.reads.length > 0 && now - (s.reads[0] as number) > confirmMs) s.reads.shift();

        if (s.emittedAt !== null && (!s.cleared || now - s.emittedAt < repeatMs)) continue;
        if (s.reads.length < confirmFrames) continue;
        if (isMisreadOf(key, now)) continue;
        s.emittedAt = now;
        s.cleared = false;
        s.reads = [];
        out.push(key);
      }
      return out;
    },
    reset() {
      seen.clear();
    },
  };
}
