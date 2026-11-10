import { describe, expect, it } from 'vitest';
import { CATEGORY_KEYS } from '@/domain/types';
import { CATEGORY_ICONS, categoryVisual, DEFAULT_CATEGORY_VISUALS } from './categories';

describe('categories', () => {
  it('covers the 28 default slugs with a curated icon', () => {
    expect(Object.keys(DEFAULT_CATEGORY_VISUALS).sort()).toEqual([...CATEGORY_KEYS].sort());
    for (const v of Object.values(DEFAULT_CATEGORY_VISUALS)) expect(CATEGORY_ICONS[v.icon]).toBeDefined();
  });

  it('has 48 curated icons', () => {
    expect(Object.keys(CATEGORY_ICONS)).toHaveLength(48);
  });

  it('applies overrides and falls back on unknown values', () => {
    expect(categoryVisual({ templateKey: 'vin' })).toMatchObject({ iconName: 'wine', hue: 'plum' });
    expect(categoryVisual({ templateKey: 'vin', icon: 'grape', color: 'rose' })).toMatchObject({
      iconName: 'grape',
      hue: 'rose',
    });
    expect(categoryVisual({ templateKey: null, icon: 'nope', color: 'red' })).toMatchObject({
      iconName: 'shapes',
      hue: 'pebble',
    });
  });
});
