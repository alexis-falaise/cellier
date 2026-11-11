import { describe, expect, it } from 'vitest';
import type { ProductId } from '@/domain/types';
import { FOODS_BY_SLUG, SEASONAL_FOODS, SWAPS } from './catalog';
import { foodOf, foodOfProduct } from './match';
import { type MonthIndex, monthIndex, type SeasonalInput, seasonalSuggestions, seasonStart } from './suggest';
import type { KnownFood, ListedFood } from './types';

const NOV_2026 = monthIndex(2026, 11);
const JUL_2026 = monthIndex(2026, 7);
const id = (s: string) => s as ProductId;
/** Purchase times are month indexes in these tests. */
const monthOfTime = (t: number): MonthIndex => t;

function listed(slug: string | null, over: Partial<ListedFood> = {}): ListedFood {
  return { ref: `row:${slug}`, name: slug ?? 'Liquide vaisselle', slug, checked: false, ...over };
}

function known(slug: string, over: Partial<KnownFood> = {}): KnownFood {
  return { productId: id(`p-${slug}`), slug, inStock: false, lastBoughtAt: null, ...over };
}

function run(over: Partial<SeasonalInput>) {
  return seasonalSuggestions({ now: NOV_2026, listed: [], known: [], dismissed: new Set(), monthOfTime, ...over });
}

describe('calendar', () => {
  it('has the ADEME foods and the regulated seasons, with valid months', () => {
    expect(SEASONAL_FOODS.length).toBeGreaterThan(70);
    for (const e of SEASONAL_FOODS) {
      expect(e.months.length).toBeGreaterThan(0);
      for (const m of e.months) expect(m).toBeGreaterThanOrEqual(1);
      for (const m of e.months) expect(m).toBeLessThanOrEqual(12);
    }
    expect(FOODS_BY_SLUG.get('courge')?.months).toContain(10);
    expect(FOODS_BY_SLUG.get('saintjacques')?.group).toBe('mer');
  });

  it('only swaps to foods that exist', () => {
    for (const [from, to] of Object.entries(SWAPS)) {
      expect(FOODS_BY_SLUG.has(from), from).toBe(true);
      for (const slug of to) expect(FOODS_BY_SLUG.has(slug), `${from} → ${slug}`).toBe(true);
    }
  });
});

describe('foodOf', () => {
  it.each([
    ['Avocats', 'avocat'],
    ['2 kg de tomates', 'tomate'],
    ['Tomates cerises', 'tomate'],
    ['barquette de fraises', 'fraise'],
    ['Chou-fleur', 'choufleur'],
    ['Choux de Bruxelles', 'choudebruxelles'],
    ['Butternut', 'courge'],
    ['Potimarron bio', 'courge'],
    ['Haricots verts', 'haricotvert'],
    ['Noix de coco', 'noixdecoco'],
    ['Noix de Saint-Jacques', 'saintjacques'],
    ['Mont d’Or', 'montdor'],
    ['Huîtres creuses n°3', 'huitre'],
    ['Salade', 'laitue'],
    ['Pêches', 'peche'],
  ])('%s → %s', (text, slug) => {
    expect(foodOf(text)).toBe(slug);
  });

  it.each([
    'Sauce tomate',
    'Jus d’orange',
    'Confiture de fraises',
    'Pommes de terre',
    'Raisins secs',
    'Tomates pelées',
    'Noix de cajou',
    'Liquide vaisselle',
    '',
  ])('%s → nothing', (text) => {
    expect(foodOf(text)).toBeNull();
  });

  it('reads products by kind, then name, only in fresh categories', () => {
    expect(foodOfProduct({ kind: 'courge butternut', name: 'Butternut bio 1 pièce', categoryKey: 'legumes' })).toBe(
      'courge',
    );
    expect(foodOfProduct({ kind: null, name: 'Avocat Hass', categoryKey: null })).toBe('avocat');
    expect(foodOfProduct({ kind: 'haricots verts', name: 'Haricots verts extra-fins', categoryKey: 'surgeles' })).toBe(
      null,
    );
    expect(foodOfProduct({ kind: 'confiture', name: 'Fraise', categoryKey: 'epicerie_sucree' })).toBeNull();
  });
});

describe('seasonStart', () => {
  it('walks back across the new year', () => {
    const courge = FOODS_BY_SLUG.get('courge');
    if (!courge) throw new Error('courge');
    // Courge: September to January.
    expect(seasonStart(courge, monthIndex(2027, 1))).toBe(monthIndex(2026, 9));
    expect(seasonStart(courge, JUL_2026)).toBeNull();
  });
});

describe('seasonalSuggestions', () => {
  it('swaps avocados for squash in the fall', () => {
    const out = run({ listed: [listed('avocat', { name: 'Avocats' })] });
    expect(out[0]).toMatchObject({
      slug: 'courge',
      reason: 'swap',
      replaces: { ref: 'row:avocat', name: 'Avocats', why: 'imported' },
      productId: null,
    });
  });

  it('swaps an out-of-season food and prefers a replacement the household buys', () => {
    const out = run({ listed: [listed('tomate')], known: [known('mache', { inStock: true })] });
    expect(out[0]).toMatchObject({
      slug: 'mache',
      reason: 'swap',
      replaces: { why: 'out-of-season' },
      productId: 'p-mache',
    });
  });

  it('leaves in-season foods, staples and checked rows alone', () => {
    const out = run({
      listed: [listed('courge'), listed('carotte'), listed('tomate', { checked: true }), listed(null)],
    });
    expect(out.filter((s) => s.reason === 'swap')).toEqual([]);
  });

  it('does not suggest what is listed or dismissed', () => {
    const out = run({ listed: [listed('avocat'), listed('courge')], dismissed: new Set(['potiron']) });
    expect(out[0]).toMatchObject({ slug: 'betterave', reason: 'swap' });
    expect(out.map((s) => s.slug)).not.toContain('courge');
    expect(out.map((s) => s.slug)).not.toContain('potiron');
  });

  it('suggests foods bought in an earlier season, most recent first, not in stock', () => {
    const out = run({
      known: [
        known('clementine', { lastBoughtAt: monthIndex(2026, 1) }),
        known('kaki', { lastBoughtAt: monthIndex(2025, 11) }),
        known('courge', { lastBoughtAt: monthIndex(2026, 10) }), // bought this season: a habit, not «back»
        known('poireau', { lastBoughtAt: monthIndex(2026, 2), inStock: true }),
        known('tomate', { lastBoughtAt: monthIndex(2026, 8) }), // out of season now
      ],
    });
    const back = out.filter((s) => s.reason === 'back');
    expect(back.map((s) => s.slug)).toEqual(['clementine', 'kaki']);
    expect(back[0]?.productId).toBe('p-clementine');
  });

  it('suggests foods whose season starts this month, lowest footprint first, within the cap', () => {
    const out = run({});
    expect(out.every((s) => s.reason === 'starting')).toBe(true);
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThanOrEqual(3);
    for (const s of out) {
      const e = FOODS_BY_SLUG.get(s.slug);
      expect(e?.months).toContain(11);
      expect(e?.months).not.toContain(10);
    }
    const footprints = out.map((s) => FOODS_BY_SLUG.get(s.slug)?.kgCo2e ?? Number.POSITIVE_INFINITY);
    expect([...footprints].sort((a, b) => a - b)).toEqual(footprints);
  });

  it('keeps back-in-season and starting together within four', () => {
    const out = run({
      known: ['clementine', 'kaki', 'poireau', 'mache'].map((s) => known(s, { lastBoughtAt: monthIndex(2025, 3) })),
    });
    expect(out.filter((s) => s.reason !== 'swap').length).toBeLessThanOrEqual(4);
  });

  it('works in summer too', () => {
    const out = run({ now: JUL_2026, listed: [listed('courge'), listed('clementine')] });
    const swaps = out.filter((s) => s.reason === 'swap').map((s) => s.slug);
    expect(swaps).toEqual(['courgette', 'fraise']);
  });
});
