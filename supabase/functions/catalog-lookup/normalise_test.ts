import { assert, assertEquals } from '@std/assert';
import { canonicalTagForm, mapCategory } from './category.ts';
import { normalise, normaliseBrand, normaliseName } from './normalise.ts';
import { storeTags } from './retailers.ts';
import type { CategoryRulesArtefact, OffRecord } from './types.ts';

const load = (f: string) => JSON.parse(Deno.readTextFileSync(new URL(`./fixtures/${f}`, import.meta.url)));

Deno.test('normalise: Nutella fixture', () => {
  const rec = load('off-nutella.json').product as OffRecord;
  const r = normalise(rec, 'off', '03017620422003', null);
  assert(r.ok);
  assertEquals(r.product, {
    gtin: '03017620422003',
    name: 'Nutella',
    brand: 'Ferrero',
    quantityLabel: '400 g e',
    netQuantity: 400,
    netUnit: 'g',
    packCount: 1,
    categoryKey: null,
    categoryRule: null,
    imageUrl: 'https://images.openfoodfacts.org/images/products/301/762/042/2003/front_fr.633.200.jpg',
    source: 'off',
    storeTags: ['leclerc', 'carrefour'],
    popularity: 4312,
    priceCents: null,
    priceObservedOn: null,
    priceChain: null,
    sourceModifiedAt: '2024-10-27T03:33:20.000Z',
  });
  assertEquals(r.categoryTags.length, 5);
});

Deno.test('normalise: Le Chat (OPF), string timestamp', () => {
  const r = normalise(load('off-lechat.json').product, 'opf', '03178041328290', null);
  assert(r.ok);
  assertEquals([r.product.netQuantity, r.product.netUnit, r.product.packCount], [1890, 'ml', 1]);
  assertEquals(r.product.source, 'opf');
  assertEquals(r.product.storeTags, []);
  assertEquals(r.product.popularity, 0);
  assertEquals(r.product.sourceModifiedAt, new Date(1729000000 * 1000).toISOString());
});

Deno.test('normalise: nameless record gives a draft', () => {
  const r = normalise(load('off-nameless.json').product, 'off', '03560070000001', null);
  assert(!r.ok);
  assertEquals(r.draft, {
    brand: 'Carrefour',
    quantityLabel: '6 x 33 cl',
    netQuantity: 330,
    netUnit: 'ml',
    packCount: 6,
    categoryKey: null,
    imageUrl: 'https://images.openfoodfacts.org/images/products/356/007/000/0001/front_fr.4.200.jpg',
  });
});

Deno.test('normaliseName rules (section 4.1)', () => {
  assertEquals(normaliseName({ product_name: '  Lait   demi-écrémé  ' }), 'Lait demi-écrémé');
  assertEquals(normaliseName({ product_name_fr: 'Pâtes', product_name: 'Pasta' }), 'Pâtes');
  assertEquals(normaliseName({ product_name: '', generic_name_fr: 'Biscuits' }), 'Biscuits');
  assertEquals(normaliseName({ product_name: 'Super promo!!!' }), 'Super promo');
  assertEquals(normaliseName({ product_name: '***' }), null);
  assertEquals(normaliseName({ product_name: '12345' }), null);
  assertEquals(normaliseName({ product_name: 'X' }), null);
  assertEquals(normaliseName({}), null);
  const long = normaliseName({ product_name: 'mot '.repeat(80) });
  assert(long !== null && long.length <= 200 && !long.endsWith(' '));
  assertEquals(normaliseName({ product_name: 'Café' }), 'Café');
});

Deno.test('normaliseBrand (section 4.2)', () => {
  assertEquals(normaliseBrand('Ferrero, Nutella'), 'Ferrero');
  assertEquals(normaliseBrand('  '), null);
  assertEquals(normaliseBrand(null), null);
  assertEquals(normaliseBrand('x'.repeat(150))?.length, 120);
});

Deno.test('storeTags (section 4.4)', () => {
  assertEquals(storeTags({ storesTags: ['E.Leclerc'], brandsTags: [], brandless: false, gtin: '03017620422003' }), ['leclerc']);
  assertEquals(storeTags({ storesTags: [], brandsTags: ['marque-repere'], brandless: false, gtin: '03017620422003' }), ['leclerc']);
  assertEquals(storeTags({ storesTags: [], brandsTags: ['carrefour-bio'], brandless: false, gtin: '03017620422003' }), ['carrefour']);
  assertEquals(storeTags({ storesTags: [], brandsTags: [], brandless: true, gtin: '03560070123456' }), ['carrefour']);
  assertEquals(storeTags({ storesTags: [], brandsTags: ['x'], brandless: false, gtin: '03564700123456' }), []);
});

const RULES: CategoryRulesArtefact = {
  format: 1,
  version: 1,
  builtAt: '2026-11-10T00:00:00Z',
  taxonomies: {} as CategoryRulesArtefact['taxonomies'],
  categories: [],
  tagRules: {
    tier0: { 'en:household-chemicals': 'entretien', 'en:toilet-papers': 'papier', 'en:household-supplies': 'entretien' },
    tier1: { 'en:frozen-pizzas': 'surgeles' },
    tier2: { 'en:hazelnut-spreads': 'petit_dej', 'en:wines': 'vin', 'en:red-wines': 'vin', 'en:pizzas': 'plats' },
  },
  ancestors: { 'en:bordeaux-wines': ['en:red-wines', 'en:wines'], 'fr:liquide-vaisselle': ['en:household-chemicals'] },
  depth: {
    'en:household-chemicals': 1, 'en:toilet-papers': 2, 'en:household-supplies': 1, 'en:frozen-pizzas': 2,
    'en:pizzas': 1, 'en:hazelnut-spreads': 3, 'en:spreads': 1, 'en:wines': 1, 'en:red-wines': 2,
    'en:bordeaux-wines': 3, 'fr:liquide-vaisselle': 3,
  },
  synonyms: {},
  ignoredTags: ['en:non-food-products'],
  foodGroups: { 'en:sweets': 'chocolat' },
  pnns2: {},
  pnns1: {},
  nameRegexes: [{ pattern: '\\bb[ée]b[ée]\\b|naturnes', categoryKey: 'bebe' }, { pattern: 'x', categoryKey: 'autre' }, {
    pattern: 'dentifrice|toothpaste',
    categoryKey: 'hygiene',
  }],
  databaseDefaults: { obf: 'hygiene', opff: 'animaux' },
  finalFallback: 'autre',
};

Deno.test('mapCategory: section 5.3 worked examples with a test artefact', () => {
  const m = (tags: string[], name = 'n', source: 'off' | 'obf' | 'opf' = 'off', fg: string[] = []) =>
    mapCategory({ source, categoriesTags: tags, foodGroupsTags: fg, name }, RULES);
  assertEquals(m(['en:spreads', 'en:hazelnut-spreads']), { categoryKey: 'petit_dej', categoryRule: 'v1|tier2:en:hazelnut-spreads' });
  assertEquals(m(['en:wines', 'en:red-wines', 'en:bordeaux-wines']).categoryRule, 'v1|tier2:en:red-wines');
  assertEquals(m(['en:pizzas', 'en:frozen-pizzas']).categoryRule, 'v1|tier1:en:frozen-pizzas');
  assertEquals(m(['en:household-supplies', 'en:toilet-papers']).categoryRule, 'v1|tier0:en:toilet-papers');
  assertEquals(m(['fr:Liquide vaisselle']).categoryKey, 'entretien');
  assertEquals(m([], 'Naturnes pommes'), { categoryKey: 'bebe', categoryRule: 'v1|name:0' });
  assertEquals(m(['en:non-food-products', 'en:Dents'], 'Dentifrice', 'obf'), { categoryKey: 'hygiene', categoryRule: 'v1|name:2' });
  assertEquals(m([], 'Shampoing', 'obf'), { categoryKey: 'hygiene', categoryRule: 'v1|db:obf' });
  assertEquals(m([], 'Nothing', 'opf'), { categoryKey: 'autre', categoryRule: 'v1|fallback' });
  assertEquals(m([], 'Nothing', 'off', ['en:sugary-snacks', 'en:sweets']).categoryRule, 'v1|fg:en:sweets');
});

Deno.test('canonicalTagForm', () => {
  assertEquals(canonicalTagForm('fr:Liquide vaisselle'), 'fr:liquide-vaisselle');
  assertEquals(canonicalTagForm('EN:Crème Fraîche'), 'en:creme-fraiche');
});
