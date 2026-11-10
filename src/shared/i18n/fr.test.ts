import { describe, expect, it } from 'vitest';
import { fr, type MessageKey, pluralForm, t } from './fr';
import { frenchTypography, NBSP, NNBSP } from './typography';

describe('t', () => {
  it('returns the French string for a key', () => {
    expect(t('app.name')).toBe('Cellier');
    expect(t('update.reload')).toBe('Recharger');
    expect(t('auth.signingIn')).toBe('Connexion…');
  });

  it('fills placeholders', () => {
    expect(t('a11y.pantry.switcher', { name: 'Cave' })).toBe(`Cellier${NBSP}: Cave`);
    expect(t('trip.date.approx', { date: 'jeudi 14 nov.' })).toBe('vers jeudi 14 nov.');
  });

  it('formats numeric parameters with Intl', () => {
    expect(t('item.alert.suggested', { n: 1500 })).toBe(`Suggéré${NBSP}: 1${NNBSP}500`);
  });

  it('distinguishes keys that are prefixes of other keys', () => {
    expect(t('pantry.delete')).toBe('Supprimer le cellier');
    expect(t('pantry.delete.title', { pantry: 'Cave' })).toBe(`Supprimer «${NNBSP}Cave${NNBSP}»${NNBSP}?`);
  });
});

describe('plurals', () => {
  it('uses one for 0 and 1, other from 2', () => {
    expect(t('common.itemsCount', { n: 0 })).toBe('0 article');
    expect(t('common.itemsCount', { n: 1 })).toBe('1 article');
    expect(t('common.itemsCount', { n: 2 })).toBe('2 articles');
    expect(t('sync.indicator.pending', { n: 3 })).toBe('3 modifications en attente');
  });

  it('maps many to other', () => {
    expect(pluralForm(1_000_000)).toBe('other');
    expect(t('common.itemsCount', { n: 1_000_000 })).toBe(`1${NNBSP}000${NNBSP}000 articles`);
  });

  it('follows {applied} when there is no {n}', () => {
    expect(t('toast.clamp.single', { product: 'Riz', applied: 1, requested: 3 })).toBe(
      `Riz${NBSP}: 1 retiré sur 3. Il n’en restait que 1.`,
    );
    expect(t('toast.clamp.single', { product: 'Riz', applied: 2, requested: 3 })).toBe(
      `Riz${NBSP}: 2 retirés sur 3. Il n’en restait que 2.`,
    );
  });

  it('follows {k}, {d}, {w} and {u}', () => {
    expect(t('toast.scan.skipped', { k: 2 })).toBe('· 2 ignorés');
    expect(t('a11y.forecast.days', { d: 1 })).toBe('Environ 1 jour de stock');
    expect(t('a11y.forecast.weeks', { w: 3 })).toBe('Environ 3 semaines de stock');
    expect(t('unit.count', { u: 12 })).toBe('12 unités');
  });

  it('uses {n} first when there are two counts', () => {
    const u = t('unit.count', { u: 5 });
    expect(t('stock.footer', { n: 1, u })).toBe('1 article · 5 unités');
  });
});

describe('catalogue typography', () => {
  const texts = Object.values(fr).flatMap((entry) => (typeof entry === 'string' ? [entry] : [entry.one, entry.other]));

  it('has no ordinary space before punctuation, inside guillemets or after ≈ ×', () => {
    for (const text of texts) expect(text).not.toMatch(/ [:;!?»]|« |[≈×] /);
  });

  it('uses typographic apostrophes', () => {
    for (const text of texts) expect(text).not.toContain("'");
  });

  it('puts narrow no-break spaces between numbers and units', () => {
    expect(t('forecast.badge.days', { d: 4 })).toBe(`≈${NNBSP}4${NNBSP}j`);
    expect(t('stock.group.price.lt2')).toBe(`Moins de 2${NNBSP}€`);
    expect(t('notify.card.body')).toContain(`18${NNBSP}h`);
  });

  it('is idempotent', () => {
    const once = frenchTypography('Ex. : « a » ! ≈ 4 j');
    expect(once).toBe(`Ex.${NBSP}: «${NNBSP}a${NNBSP}»${NNBSP}! ≈${NNBSP}4${NNBSP}j`);
    expect(frenchTypography(once)).toBe(once);
  });

  it('holds every deck key', () => {
    const keys = Object.keys(fr) as MessageKey[];
    expect(keys).toContain('category.default.petit_dej');
    expect(keys).toContain('unit.l');
    expect(keys).toHaveLength(597);
  });
});
