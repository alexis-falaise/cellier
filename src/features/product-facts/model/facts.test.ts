import { describe, expect, it, vi } from 'vitest';
import {
  cleanIngredients,
  isFresh,
  normaliseFacts,
  notFoundFacts,
} from '../../../../supabase/functions/product-facts/facts.ts';
import cream from '../../../../supabase/functions/product-facts/fixtures/obf-cream-facts.json';
import nutella from '../../../../supabase/functions/product-facts/fixtures/off-nutella-facts.json';
import { analysisChips, hasDisplayableFacts, toProductFacts, visibleLabels } from './facts';
import { createFactsLoader, type FactsClient } from './load';

const NUTELLA = '03017620422003';
const CREAM = '03337875598996';

describe('normaliseFacts', () => {
  it('keeps grades, nutrition and composition of a food record', () => {
    const row = normaliseFacts(NUTELLA, nutella.product, 'off');
    expect(row).toMatchObject({
      gtin: NUTELLA,
      found: true,
      source: 'off',
      nutriscore_grade: 'e',
      nova_group: 3,
      ecoscore_grade: 'f',
      nutrient_levels: { fat: 'high', saturated_fat: 'high', sugars: 'high', salt: 'low' },
      allergens: ['en:milk', 'en:nuts', 'en:soybeans'],
      additives: [],
      analysis: ['en:palm-oil', 'en:vegetarian'],
      period_after_opening_months: null,
    });
    expect(row.nutriments.energy_kcal).toBe(539);
    expect(row.nutriments.sugars).toBeCloseTo(56.3, 1);
    expect(row.ingredients_text?.startsWith('Sucre, huile de palme')).toBe(true);
    expect(row.source_modified_at).toBe(new Date(1794233882 * 1000).toISOString());
  });

  it('drops food grades for a beauty record (OBF reports a meaningless NOVA 4)', () => {
    const row = normaliseFacts(CREAM, cream.product, 'off');
    expect(row.source).toBe('obf');
    expect(row.nutriscore_grade).toBeNull();
    expect(row.nova_group).toBeNull();
    expect(row.ecoscore_grade).toBeNull();
    expect(row.nutriments).toEqual({});
    expect(row.additives.slice(0, 3)).toEqual(['E1210', 'E306', 'E340']);
    expect(row.labels).toEqual(['en:without-perfume']);
    expect(row.origins).toBe('France');
    expect(row.ingredients_text?.startsWith('Eau, glycérine')).toBe(true);
  });

  it('derives kcal from kJ and salt from sodium', () => {
    const row = normaliseFacts(
      NUTELLA,
      { product_type: 'food', nutriments: { energy_100g: 2000, sodium_100g: 0.4 } },
      'off',
    );
    expect(row.nutriments).toEqual({ energy_kcal: 478, salt: 1 });
  });

  it('reads the period after opening of a cosmetic', () => {
    const row = normaliseFacts(CREAM, { product_type: 'beauty', periods_after_opening: '12 months' }, 'off');
    expect(row.period_after_opening_months).toBe(12);
  });

  it('cleans allergen underscores and whitespace', () => {
    expect(cleanIngredients('  Farine de _blé_,\n _lait_ ')).toBe('Farine de blé, lait');
    expect(cleanIngredients('   ')).toBeNull();
  });
});

describe('freshness', () => {
  const now = Date.parse('2026-11-11T12:00:00Z');
  it('keeps found rows 30 days and misses 7 days', () => {
    expect(isFresh({ found: true, fetched_at: '2026-10-20T12:00:00Z' }, now)).toBe(true);
    expect(isFresh({ found: true, fetched_at: '2026-10-01T12:00:00Z' }, now)).toBe(false);
    expect(isFresh({ found: false, fetched_at: '2026-11-08T12:00:00Z' }, now)).toBe(true);
    expect(isFresh({ found: false, fetched_at: '2026-11-01T12:00:00Z' }, now)).toBe(false);
    expect(isFresh({ found: true }, now)).toBe(false);
  });
});

describe('toProductFacts and display helpers', () => {
  const facts = toProductFacts({
    ...normaliseFacts(NUTELLA, nutella.product, 'off'),
    fetched_at: '2026-11-11T00:00:00Z',
  });

  it('parses a row', () => {
    expect(facts).toMatchObject({ nutriscore: 'e', nova: 3, ecoscore: 'f', fetchedAt: '2026-11-11T00:00:00Z' });
    expect(toProductFacts({ gtin: 1 })).toBeNull();
    expect(toProductFacts({ gtin: 'x', found: true, nutriscore_grade: 'z', nova_group: 9 })).toMatchObject({
      nutriscore: null,
      nova: null,
    });
  });

  it('hides logo labels and shows palm oil and vegetarian chips', () => {
    if (!facts) throw new Error('parse failed');
    expect(visibleLabels(facts)).toEqual(['Végétarien', 'Sans gluten']);
    expect(analysisChips(facts).map((c) => c.label)).toEqual(['Huile de palme', 'Végétarien']);
    expect(hasDisplayableFacts(facts)).toBe(true);
  });

  it('has nothing to show for a miss', () => {
    const miss = toProductFacts({ ...notFoundFacts(NUTELLA), fetched_at: '2026-11-11T00:00:00Z' });
    expect(miss && hasDisplayableFacts(miss)).toBe(false);
  });
});

describe('createFactsLoader', () => {
  const now = Date.parse('2026-11-11T12:00:00Z');
  const fresh = { ...normaliseFacts(NUTELLA, nutella.product, 'off'), fetched_at: '2026-11-10T00:00:00Z' };
  const stale = { ...fresh, fetched_at: '2026-09-01T00:00:00Z' };

  function fakeClient(row: unknown, fnRow: unknown) {
    const invoke = vi.fn(async () => ({ data: { outcome: 'ok', facts: fnRow }, error: null }));
    const client: FactsClient = {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }),
      functions: { invoke },
    };
    return { client, invoke };
  }

  function memoryStorage() {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  }

  const settle = (loader: ReturnType<typeof createFactsLoader>, gtin: string) =>
    new Promise<{ updates: number; last: ReturnType<typeof toProductFacts> }>((resolve) => {
      let updates = 0;
      loader.load(gtin, (u) => {
        updates += 1;
        if (u.settled) resolve({ updates, last: u.facts });
      });
    });

  it('uses a fresh table row without calling the function', async () => {
    const { client, invoke } = fakeClient(fresh, null);
    const loader = createFactsLoader({ client: async () => client, now: () => now, isOnline: () => true });
    const { last } = await settle(loader, NUTELLA);
    expect(last?.nutriscore).toBe('e');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('calls the function when the table row is stale or missing, then serves from the device cache', async () => {
    const { client, invoke } = fakeClient(stale, fresh);
    const storage = memoryStorage();
    const loader = createFactsLoader({ client: async () => client, storage, now: () => now, isOnline: () => true });
    const first = await settle(loader, NUTELLA);
    expect(first.last?.fetchedAt).toBe('2026-11-10T00:00:00Z');
    expect(invoke).toHaveBeenCalledTimes(1);

    const again = createFactsLoader({ client: async () => client, storage, now: () => now, isOnline: () => true });
    const second = await settle(again, NUTELLA);
    expect(second).toMatchObject({ updates: 1 });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('settles as failed offline with nothing cached', async () => {
    const { client } = fakeClient(null, null);
    const loader = createFactsLoader({ client: async () => client, now: () => now, isOnline: () => false });
    const result = await new Promise((resolve) => loader.load(NUTELLA, resolve));
    expect(result).toEqual({ facts: null, settled: true, failed: true });
  });
});
