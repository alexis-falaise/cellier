import { describe, expect, it } from 'vitest';
import type { Category } from '@/domain/types';
import type { Cadence, GroceryItem, NextTrip, ProductForecast } from '@/features/forecast';
import { NBSP } from '@/shared/i18n';
import {
  groceryReasonText,
  groupByCategory,
  shareText,
  tripDateText,
  tripPreview,
  tripReasonText,
  weekdayName,
} from './presentation';

/** Typographic spaces (U+00A0, U+202F) as plain spaces, to keep expectations readable. */
const plain = (text: string) => text.replace(/[\u00a0\u202f]/g, ' ');

const DAY = 86_400_000;
// Tuesday 10 November 2026, 15:00 local time.
const NOW = new Date(2026, 10, 10, 15).getTime();

function cadence(over: Partial<Cadence> = {}): Cadence {
  return {
    medianGapDays: 7,
    usualWeekday: 6,
    usualWeekdayShare: 0.8,
    sessions: 8,
    confidence: 'high',
    lastSessionAt: NOW - 3 * DAY,
    nextAt: NOW + 4 * DAY,
    ...over,
  };
}

function trip(at: number, c: Cadence | null, pulledForward = false): NextTrip {
  return { tripAt: at, tripOn: null, cadence: c, gapDays: 7, pulledForward };
}

function forecast(over: Omit<Partial<ProductForecast>, 'productId'> & { productId: string }): ProductForecast {
  return {
    totalQuantity: 2,
    usualQuantity: 4,
    usualQuantitySource: 'computed',
    minimum: 1,
    clearLevel: 2,
    rate: { ratePerDay: 0, rawRate: 0, shape: 1, exposureDays: 0, weightedQuantity: 0, events: 0, asOf: NOW },
    daysLeft: null,
    runOut: null,
    confidence: 'low',
    lowByThreshold: false,
    lowByForecast: false,
    runningLow: false,
    lowReason: null,
    lastRestockAt: null,
    lastSeq: null,
    lowAlert: true,
    deleted: false,
    ...over,
  } as unknown as ProductForecast;
}

describe('tripDateText', () => {
  it('says today and tomorrow first', () => {
    expect(tripDateText(trip(NOW + 3_600_000, cadence()), NOW)).toBe('aujourd’hui');
    expect(tripDateText(trip(NOW + DAY, cadence({ confidence: 'low' })), NOW)).toBe('demain');
  });

  it('gives the date by confidence', () => {
    const saturday = new Date(2026, 10, 14, 10).getTime();
    expect(tripDateText(trip(saturday, cadence()), NOW)).toBe('samedi 14 nov.');
    expect(tripDateText(trip(saturday, cadence({ confidence: 'medium' })), NOW)).toBe('vers samedi 14 nov.');
  });

  it('falls back to weeks without a reliable cadence', () => {
    expect(tripDateText(trip(new Date(2026, 10, 14).getTime(), null), NOW)).toBe('cette semaine');
    expect(tripDateText(trip(new Date(2026, 10, 17).getTime(), null), NOW)).toBe('la semaine prochaine');
    expect(tripDateText(trip(new Date(2026, 10, 26).getTime(), cadence({ confidence: 'low' })), NOW)).toBe(
      'semaine du 23 nov.',
    );
  });
});

describe('tripReasonText', () => {
  it('explains a trip pulled forward', () => {
    const forecasts = [
      forecast({ productId: 'a', runOut: { median: NOW + DAY, earliest: NOW, latest: NOW + 2 * DAY } }),
      forecast({ productId: 'b', runOut: { median: NOW + DAY, earliest: NOW, latest: NOW + 2 * DAY } }),
      forecast({ productId: 'c', runOut: { median: NOW + 9 * DAY, earliest: NOW, latest: NOW + 9 * DAY } }),
    ];
    expect(tripReasonText(trip(NOW + 2 * DAY, cadence(), true), forecasts)).toBe(
      `Avancées${NBSP}: 2 articles seront épuisés d’ici là.`,
    );
  });

  it('names the usual weekday, then the number of trips, then says it is rough', () => {
    expect(tripReasonText(trip(NOW + 4 * DAY, cadence()), [])).toBe('En général le samedi, tous les 7 jours environ.');
    expect(tripReasonText(trip(NOW + 4 * DAY, cadence({ usualWeekdayShare: 0.3 })), [])).toBe(
      'D’après vos 8 derniers passages.',
    );
    expect(tripReasonText(trip(NOW + 4 * DAY, cadence({ confidence: 'medium', sessions: 4 })), [])).toBe(
      'D’après vos 4 derniers passages.',
    );
    expect(tripReasonText(trip(NOW + 7 * DAY, null), [])).toBe(
      `Date indicative${NBSP}: encore peu de courses enregistrées.`,
    );
  });

  it('knows weekday names', () => {
    expect(weekdayName(0)).toBe('dimanche');
    expect(weekdayName(3)).toBe('mercredi');
  });
});

describe('tripPreview', () => {
  it('lists up to three names, then counts the others', () => {
    expect(tripPreview(['Lait'])).toBe('Lait');
    expect(tripPreview(['Lait', 'Café', 'Pâtes'])).toBe('Lait, Café et Pâtes');
    expect(tripPreview(['Lait', 'Café', 'Pâtes', 'Riz', 'Sel'])).toBe('Lait, Café, Pâtes et 2 autres');
    expect(tripPreview(['Lait', 'Café', 'Pâtes', 'Riz'])).toBe('Lait, Café, Pâtes et 1 autre');
  });
});

const product = (
  over: Omit<Partial<Extract<GroceryItem, { kind: 'product' }>>, 'productId'> & { productId?: string },
): GroceryItem =>
  ({
    kind: 'product',
    key: `suggested:${over.productId ?? 'p'}`,
    productId: 'p',
    name: 'Lait',
    entryId: null,
    quantity: 2,
    suggestedQuantity: 2,
    reason: 'threshold',
    urgencyDays: 0,
    totalQuantity: 1,
    runOut: null,
    confidence: 'low',
    checked: false,
    addedBy: null,
    ...over,
  }) as GroceryItem;

const label = (text: string, checked = false): GroceryItem => ({
  kind: 'label',
  key: `l:${text}`,
  entryId: `l:${text}` as never,
  label: text,
  quantity: null,
  checked,
  addedBy: null,
});

describe('groceryReasonText', () => {
  it('follows the reason of the suggestion', () => {
    const f = forecast({ productId: 'p', minimum: 2, daysLeft: 3.4 });
    expect(groceryReasonText(product({ reason: 'out', totalQuantity: 0 }), f, 'vous', NOW)).toBe('Épuisé');
    expect(groceryReasonText(product({ reason: 'threshold' }), f, 'vous', NOW)).toBe('Reste 1, seuil 2');
    expect(plain(groceryReasonText(product({ reason: 'forecast' }), f, 'vous', NOW))).toBe('Reste 1 · ≈ 3 j');
    const runOut = { median: new Date(2026, 10, 18).getTime(), earliest: NOW, latest: NOW };
    expect(groceryReasonText(product({ reason: 'before-next-trip', runOut }), f, 'vous', NOW)).toBe(
      'Épuisement vers le 18 nov.',
    );
  });

  it('says who added manual rows', () => {
    expect(groceryReasonText(product({ reason: 'manual' }), undefined, 'Bob', NOW)).toBe('Ajouté par Bob');
    expect(groceryReasonText(label('Piles'), undefined, 'vous', NOW)).toBe('Ajouté par vous · hors stock');
  });
});

describe('groupByCategory and shareText', () => {
  const cat = (id: string, name: string, sortOrder: number, templateKey: Category['templateKey']): Category =>
    ({ id, name, sortOrder, templateKey, icon: null, color: null, deletedAt: null }) as unknown as Category;
  const categories = [
    cat('dairy', 'Produits laitiers', 1, 'laitier'),
    cat('pasta', 'Épicerie salée', 2, 'feculents'),
    cat('other', 'Autres', 9, 'autre'),
  ];
  const categoryOf = (productId: string) =>
    ({ milk: categories[0], butter: categories[0], spaghetti: categories[1] })[productId] ?? null;

  const items: GroceryItem[] = [
    product({ productId: 'spaghetti', name: 'Pâtes', quantity: 3 }),
    product({ productId: 'milk', name: 'Lait', quantity: 2 }),
    label('Piles'),
    product({ productId: 'mystery', name: 'Truc', quantity: 1 }),
    product({ productId: 'butter', name: 'Beurre', quantity: 1, checked: true }),
  ];

  it('orders sections by category order, «Autres» last, keeping row order', () => {
    const sections = groupByCategory(items, categoryOf, categories);
    expect(sections.map((s) => [s.title, s.items.map((i) => (i.kind === 'product' ? i.name : i.label))])).toEqual([
      ['Produits laitiers', ['Lait', 'Beurre']],
      ['Épicerie salée', ['Pâtes']],
      ['Autres', ['Piles', 'Truc']],
    ]);
  });

  it('shares unchecked rows by section', () => {
    const sections = groupByCategory(items, categoryOf, categories);
    expect(plain(shareText('samedi 14 nov.', sections))).toBe(
      [
        'Courses · samedi 14 nov.',
        '',
        'Produits laitiers',
        '– Lait × 2',
        '',
        'Épicerie salée',
        '– Pâtes × 3',
        '',
        'Autres',
        '– Piles × 1',
        '– Truc × 1',
      ].join('\n'),
    );
  });
});
