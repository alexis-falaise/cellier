import { describe, expect, it } from 'vitest';
import { installContext } from './installContext';

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/139.0 Mobile/15E148 Safari/604.1';
const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15';

describe('installContext', () => {
  const base = { platform: 'iPhone', maxTouchPoints: 5, standalone: false };

  it('detects the installed app first', () => {
    expect(installContext({ ...base, userAgent: IPHONE_SAFARI, standalone: true })).toBe('standalone');
  });

  it('tells Safari from other iOS browsers', () => {
    expect(installContext({ ...base, userAgent: IPHONE_SAFARI })).toBe('ios-safari');
    expect(installContext({ ...base, userAgent: IPHONE_CHROME })).toBe('ios-other');
  });

  it('treats iPadOS reporting a Mac as iOS, and a real Mac as other', () => {
    expect(installContext({ userAgent: MAC, platform: 'MacIntel', maxTouchPoints: 5, standalone: false })).toBe(
      'ios-safari',
    );
    expect(installContext({ userAgent: MAC, platform: 'MacIntel', maxTouchPoints: 0, standalone: false })).toBe(
      'other',
    );
  });
});
