export interface LowLightOptions {
  /** Mean luma (0–255) under which a frame counts as dark. */
  threshold?: number;
  /** Dark frames for this long without a decode raise the hint (design 4.4.1: 2 s). */
  delayMs?: number;
}

export interface LowLightMonitor {
  /** Feeds one decoded frame; returns the current low-light state. */
  frame(luma: number, decoded: boolean, now: number): boolean;
  reset(): void;
}

export function createLowLightMonitor({ threshold = 45, delayMs = 2000 }: LowLightOptions = {}): LowLightMonitor {
  let darkSince: number | null = null;
  let low = false;
  // Hysteresis so the hint does not flicker around the threshold.
  const brightAgain = threshold * 1.25;

  return {
    frame(luma, decoded, now) {
      if (decoded) {
        darkSince = null;
        low = false;
        return low;
      }
      if (luma < threshold) {
        darkSince ??= now;
        if (now - darkSince >= delayMs) low = true;
      } else if (luma >= brightAgain || !low) {
        darkSince = null;
        low = false;
      }
      return low;
    },
    reset() {
      darkSince = null;
      low = false;
    },
  };
}
