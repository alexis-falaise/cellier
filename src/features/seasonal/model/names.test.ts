import { afterEach, describe, expect, it } from 'vitest';
import { setActiveLocale } from '@/shared/i18n';
import { SEASONAL_FOODS } from './catalog';
import { foodOf } from './match';
import { englishSingular, FOOD_NAMES_EN, FOOD_NAMES_SV, FOOD_SINGULARS_SV, foodName } from './names';
import { monthIndex, seasonalSuggestions } from './suggest';

afterEach(() => setActiveLocale('fr'));

describe('seasonal food names', () => {
  it('names every food of the calendar in English and Swedish, and nothing else', () => {
    const slugs = SEASONAL_FOODS.map((e) => e.slug).sort();
    expect(Object.keys(FOOD_NAMES_EN).sort()).toEqual(slugs);
    expect(Object.keys(FOOD_NAMES_SV).sort()).toEqual(slugs);
    for (const slug of Object.keys(FOOD_SINGULARS_SV)) expect(slugs).toContain(slug);
  });

  it('follows the active language', () => {
    expect(foodName('courge')).toBe('Courge');
    setActiveLocale('en');
    expect(foodName('courge')).toBe('Squash');
    setActiveLocale('sv');
    expect(foodName('fraise')).toBe('Jordgubbar');
    expect(foodName('unknown')).toBe('unknown');
  });

  it('suggests foods under their translated name', () => {
    setActiveLocale('sv');
    const suggestions = seasonalSuggestions({
      now: monthIndex(2026, 11),
      listed: [{ ref: 'row:tomate', name: 'Tomater', slug: 'tomate', checked: false }],
      known: [],
      dismissed: new Set(),
      monthOfTime: (t) => t,
    });
    expect(suggestions[0]).toMatchObject({ reason: 'swap', replaces: { name: 'Tomater' } });
    expect(suggestions[0]?.name).toBe(FOOD_NAMES_SV[suggestions[0]?.slug ?? '']);
  });
});

describe('matching translated names', () => {
  it('recognises a suggestion once it is on the list, in any language', () => {
    for (const [slug, name] of [...Object.entries(FOOD_NAMES_EN), ...Object.entries(FOOD_NAMES_SV)]) {
      const found = foodOf(name);
      // The two mangoes share a name once the «by air» note is dropped; pumpkins overlap by design.
      if (slug === 'mangue' || slug === 'manguebateau') expect(['mangue', 'manguebateau']).toContain(found);
      else expect(found, name).toBe(slug);
    }
  });

  it('accepts singulars, plurals and a quantity in front', () => {
    expect(foodOf('Tomato')).toBe('tomate');
    expect(foodOf('tomatoes')).toBe('tomate');
    expect(foodOf('Cherry')).toBe('cerise');
    expect(foodOf('2 kg Tomater')).toBe('tomate');
    expect(foodOf('Tomat')).toBe('tomate');
    expect(foodOf('Morot')).toBe('carotte');
  });

  it('does not take an English processed product for the fresh food', () => {
    expect(foodOf('Tomato soup')).toBeNull();
    expect(foodOf('Apple juice')).toBeNull();
    expect(foodOf('Jerusalem artichokes')).toBe('topinambour');
  });

  it('still matches French by prefix', () => {
    expect(foodOf('Tomates cerises')).toBe('tomate');
    expect(foodOf('Sauce tomate')).toBeNull();
  });

  it('turns English plurals into singulars', () => {
    expect(englishSingular('Cherries')).toBe('Cherry');
    expect(englishSingular('Tomatoes')).toBe('Tomato');
    expect(englishSingular('Peaches')).toBe('Peach');
    expect(englishSingular('Carrots')).toBe('Carrot');
  });
});
