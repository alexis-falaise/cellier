import { describe, expect, it } from 'vitest';
import type { ProductId, ProductView } from '@/domain/types';
import type { KindGroup } from '@/features/forecast';
import { groceryAddOptions, matchAddOptions } from './addOptions';
import { listName } from './householdForecasts';

const id = (s: string) => s as ProductId;

function view(productId: string, name: string, kind: string | null = null): ProductView {
  return { product: { id: id(productId), name, kind }, category: null } as unknown as ProductView;
}

describe('listName', () => {
  it('names a product after what it is, else after itself', () => {
    expect(listName({ name: 'Café Moulu Colombie 250 g', kind: 'café  moulu ' })).toBe('Café moulu');
    expect(listName({ name: 'Concentré de tomates Mutti', kind: 'concentré de tomates' })).toBe('Concentré de tomates');
    expect(listName({ name: 'Bougies', kind: null })).toBe('Bougies');
    expect(listName({ name: 'Bougies', kind: ' ' })).toBe('Bougies');
  });
});

describe('«Ajouter un article» choices', () => {
  const views = [
    view('col', 'Café moulu Colombie 250 g', 'café moulu'),
    view('eth', 'Café moulu Éthiopie', 'café moulu'),
    view('grains', 'Café en grains Espresso', 'café en grains'),
    view('riz', 'Riz Arborio 1 kg', 'riz à risotto'),
    view('sel', 'Sel fin'),
  ];
  const coffee: KindGroup = { label: 'café moulu', representative: id('eth'), members: [id('col'), id('eth')] };
  const kinds = new Map([
    [id('col'), coffee],
    [id('eth'), coffee],
  ]);
  const names = new Map(views.map((v) => [v.product.id, listName(v.product)]));
  const options = groceryAddOptions({ views, viewsById: new Map(views.map((v) => [v.product.id, v])), kinds, names });

  it('offers a kind once, on its representative, named after the kind', () => {
    expect(options.map((o) => [o.productId, o.name])).toEqual([
      ['eth', 'Café moulu'],
      ['grains', 'Café en grains'],
      ['riz', 'Riz à risotto'],
      ['sel', 'Sel fin'],
    ]);
  });

  it('matches list names first, then the products’ own names', () => {
    expect(matchAddOptions(options, 'caf', new Set()).map((o) => o.name)).toEqual(['Café moulu', 'Café en grains']);
    expect(matchAddOptions(options, 'colombie', new Set()).map((o) => o.name)).toEqual(['Café moulu']);
    expect(matchAddOptions(options, 'arborio', new Set()).map((o) => o.name)).toEqual(['Riz à risotto']);
  });

  it('skips a kind while any of its products is on the list', () => {
    expect(matchAddOptions(options, 'caf', new Set(['col'])).map((o) => o.name)).toEqual(['Café en grains']);
  });
});
