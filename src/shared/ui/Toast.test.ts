import { describe, expect, it } from 'vitest';
import { THRESHOLDS } from '@/shared/lib/motion';
import { toastLifetimeMs } from './Toast';

describe('toastLifetimeMs', () => {
  it('dismisses a plain toast after the standard lifetime', () => {
    expect(toastLifetimeMs({})).toBe(THRESHOLDS.toast.lifetimeMs);
  });

  it('keeps a toast with an action on screen longer', () => {
    expect(toastLifetimeMs({ action: { label: 'Annuler', onPress: () => undefined } })).toBe(
      THRESHOLDS.toast.lifetimeWithActionMs,
    );
  });

  it('never dismisses a persistent toast on its own', () => {
    expect(toastLifetimeMs({ persistent: true })).toBeNull();
    expect(toastLifetimeMs({ persistent: true, action: { label: 'Recharger', onPress: () => undefined } })).toBeNull();
  });
});
