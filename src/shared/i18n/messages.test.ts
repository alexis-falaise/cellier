import { afterEach, describe, expect, it } from 'vitest';
import { en } from './en';
import { type Entry, frSource, type MessageKey } from './fr';
import { LOCALES, setActiveLocale } from './locale';
import { catalogue, fr, isMessageKey, pluralForm, t } from './messages';
import { sv } from './sv';
import { frenchTypography, NBSP, NNBSP } from './typography';

afterEach(() => setActiveLocale('fr'));

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
    // 819 before the language choice + 4 language keys + 14 allergens + 25 labels + palm oil + 48 icon names
    expect(keys).toHaveLength(911);
  });
});

describe('translations', () => {
  const sources = { fr: frSource, en, sv } as const;
  const texts = (entry: Entry) => (typeof entry === 'string' ? [entry] : [entry.one, entry.other]);
  const placeholders = (entry: Entry) =>
    [...new Set(texts(entry).flatMap((text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1])))].sort();

  it('hold the same keys in every language', () => {
    const keys = Object.keys(frSource).sort();
    expect(Object.keys(en).sort()).toEqual(keys);
    expect(Object.keys(sv).sort()).toEqual(keys);
  });

  it('keep plurals plural and the placeholders of the French string', () => {
    for (const key of Object.keys(frSource) as MessageKey[]) {
      for (const locale of ['en', 'sv'] as const) {
        const entry = sources[locale][key];
        expect(typeof entry, `${locale} ${key}`).toBe(typeof frSource[key]);
        expect(placeholders(entry), `${locale} ${key}`).toEqual(placeholders(frSource[key]));
      }
    }
  });

  it('are never empty and leave no French behind', () => {
    for (const locale of ['en', 'sv'] as const) {
      for (const [key, entry] of Object.entries(sources[locale])) {
        for (const text of texts(entry)) {
          expect(text.trim(), `${locale} ${key}`).not.toBe('');
          expect(text, `${locale} ${key}`).not.toMatch(/[«»]| [:;!?]/);
          expect(text, `${locale} ${key}`).not.toContain("'");
        }
      }
    }
  });

  it('typesets every language once', () => {
    for (const locale of LOCALES) expect(catalogue(locale)).toBe(catalogue(locale));
  });

  it('recognises catalogue keys', () => {
    expect(isMessageKey('facts.label.organic')).toBe(true);
    expect(isMessageKey('facts.label.unknown')).toBe(false);
  });
});

describe('English', () => {
  it('translates and fills placeholders', () => {
    setActiveLocale('en');
    expect(t('tabs.groceries')).toBe('Shopping');
    expect(t('common.createNamed', { q: 'Tea' })).toBe('Create “Tea”');
    expect(t('a11y.pantry.switcher', { name: 'Cellar' })).toBe('Pantry: Cellar');
  });

  it('uses one for 1 only', () => {
    setActiveLocale('en');
    expect(pluralForm(0)).toBe('other');
    expect(t('common.itemsCount', { n: 0 })).toBe('0 items');
    expect(t('common.itemsCount', { n: 1 })).toBe('1 item');
    expect(t('common.itemsCount', { n: 2 })).toBe('2 items');
    expect(t('toast.clamp.single', { product: 'Rice', applied: 1, requested: 3 })).toBe(
      'Rice: 1 of 3 taken out. There was only 1 left.',
    );
  });

  it('formats numbers the British way and keeps units attached', () => {
    setActiveLocale('en');
    expect(t('item.alert.suggested', { n: 1500 })).toBe('Suggested: 1,500');
    expect(t('forecast.badge.days', { d: 4 })).toBe(`≈${NNBSP}4${NNBSP}d`);
    expect(t('forecast.badge.weeks', { w: 3 })).toBe(`≈${NNBSP}3${NNBSP}wk`);
    expect(t('notifications.digest')).toBe(`6${NNBSP}pm summary`);
  });
});

describe('Swedish', () => {
  it('translates and fills placeholders', () => {
    setActiveLocale('sv');
    expect(t('tabs.groceries')).toBe('Inköp');
    expect(t('common.createNamed', { q: 'Te' })).toBe('Skapa ”Te”');
    expect(t('pantry.delete.title', { pantry: 'Källare' })).toBe('Radera ”Källare”?');
  });

  it('uses one for 1 only', () => {
    setActiveLocale('sv');
    expect(t('common.itemsCount', { n: 0 })).toBe('0 varor');
    expect(t('common.itemsCount', { n: 1 })).toBe('1 vara');
    expect(t('settings.membersCount', { n: 3 })).toBe('3 medlemmar');
  });

  it('keeps units and «kl.» attached to their number', () => {
    setActiveLocale('sv');
    expect(t('forecast.badge.weeks', { w: 3 })).toBe(`≈${NNBSP}3${NNBSP}v`);
    expect(t('notifications.digest')).toBe(`Sammanfattning kl.${NBSP}18`);
    expect(t('value.share', { pct: 12 })).toBe(`12${NNBSP}%`);
  });
});
