import { describe, expect, it } from 'vitest';
import { isIOS, shouldFire } from './haptics';

describe('haptics', () => {
  it('throttles to one haptic per 100 ms', () => {
    expect(shouldFire(1000, Number.NEGATIVE_INFINITY)).toBe(true);
    expect(shouldFire(1050, 1000)).toBe(false);
    expect(shouldFire(1100, 1000)).toBe(true);
  });

  it('detects iOS by user agent or touch Mac, never by version', () => {
    const ua = (userAgent: string, platform = 'iPhone', maxTouchPoints = 5) => ({
      userAgent,
      platform,
      maxTouchPoints,
    });
    expect(isIOS(ua('Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X)'))).toBe(true);
    expect(isIOS(ua('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 5))).toBe(true);
    expect(isIOS(ua('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 0))).toBe(false);
    expect(isIOS(ua('Mozilla/5.0 (Linux; Android 15)', 'Linux armv8l'))).toBe(false);
  });
});
