import { describe, expect, it } from 'vitest';
import { decideLocale } from './locale';

describe('decideLocale', () => {
  it('does nothing when the device and the account agree', () => {
    expect(decideLocale({ device: 'sv', account: 'sv', unsent: false })).toEqual({ action: 'none' });
    expect(decideLocale({ device: 'sv', account: 'sv', unsent: true })).toEqual({ action: 'none' });
  });

  it('gives an account without a language the one the device uses', () => {
    expect(decideLocale({ device: 'en', account: null, unsent: false })).toEqual({ action: 'send', locale: 'en' });
    expect(decideLocale({ device: 'fr', account: 'de', unsent: false })).toEqual({ action: 'send', locale: 'fr' });
  });

  it('adopts a language changed on another device', () => {
    expect(decideLocale({ device: 'fr', account: 'sv', unsent: false })).toEqual({ action: 'adopt', locale: 'sv' });
  });

  it('sends a choice made offline instead of losing it', () => {
    expect(decideLocale({ device: 'en', account: 'fr', unsent: true })).toEqual({ action: 'send', locale: 'en' });
  });
});
