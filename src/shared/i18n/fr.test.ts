import { describe, expect, it } from 'vitest';
import { t } from './fr';

describe('t', () => {
  it('returns the French string for a key', () => {
    expect(t('app.name')).toBe('Cellier');
    expect(t('pwa.updateAvailable')).toBe('Mise à jour disponible');
  });
});
