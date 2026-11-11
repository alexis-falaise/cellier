import { describe, expect, it } from 'vitest';
import type { CategoryId, Product, ProductId } from '@/domain/types';
import { product as baseProduct } from '@/features/forecast/model/ledgerBuilder.testing';
import {
  fieldsFromAnswer,
  householdExamples,
  kindOverrideCategory,
  pendingClassification,
  propagateCategory,
} from './classify';

const cat = (id: string, templateKey: string | null) =>
  ({ id: id as CategoryId, templateKey, deletedAt: null }) as never;
const categories = [cat('c-cafe', 'cafe'), cat('c-pdj', 'petit_dej'), cat('c-autre', 'autre'), cat('c-mine', null)];
const p = (id: string, o: Partial<Product> = {}): Product =>
  baseProduct({ id: id as ProductId, name: id, updatedAt: '2026-11-01T00:00:00Z', ...o });

const answer = { id: 'new', kind: 'café moulu', categoryKey: 'cafe' as const, suggestedMin: 1 };

describe('fieldsFromAnswer', () => {
  it('takes the model category when the catalogue gave nothing', () => {
    const product = p('new', { categoryId: 'c-autre' as CategoryId });
    expect(fieldsFromAnswer(product, answer, [product], categories)).toEqual({
      kind: 'café moulu',
      kindSource: 'model',
      suggestedMin: 1,
      categoryId: 'c-cafe',
      categorySource: 'model',
    });
  });

  it('keeps a real catalogue category', () => {
    const product = p('new', { categoryId: 'c-pdj' as CategoryId, categorySource: 'catalog' });
    const fields = fieldsFromAnswer(product, answer, [product], categories);
    expect(fields.categoryId).toBeUndefined();
  });

  it('applies a member override for the kind over the catalogue category', () => {
    const product = p('new', { categoryId: 'c-pdj' as CategoryId, categorySource: 'catalog' });
    const mine = p('old', { kind: 'Café moulu', categoryId: 'c-mine' as CategoryId, categorySource: 'user' });
    const fields = fieldsFromAnswer(product, answer, [product, mine], categories);
    expect(fields.categoryId).toBe('c-mine');
  });

  it('never replaces a member category or kind', () => {
    const product = p('new', {
      categoryId: 'c-pdj' as CategoryId,
      categorySource: 'user',
      kind: 'moka',
      kindSource: 'user',
    });
    expect(fieldsFromAnswer(product, answer, [product], categories)).toEqual({ suggestedMin: 1 });
  });
});

describe('overrides', () => {
  it('finds the most recent member category of a kind', () => {
    const list = [
      p('a', {
        kind: 'café moulu',
        categoryId: 'c-cafe' as CategoryId,
        categorySource: 'user',
        updatedAt: '2026-10-01T00:00:00Z',
      }),
      p('b', {
        kind: 'cafe moulu',
        categoryId: 'c-mine' as CategoryId,
        categorySource: 'user',
        updatedAt: '2026-11-01T00:00:00Z',
      }),
    ];
    expect(kindOverrideCategory('Café moulu', list, categories)).toBe('c-mine');
  });

  it('moves the other products of the kind, except member-placed ones', () => {
    const list = [
      p('a', { kind: 'café moulu' }),
      p('b', { kind: 'café moulu', categorySource: 'model' }),
      p('c', { kind: 'café moulu', categorySource: 'user' }),
      p('d', { kind: 'thé' }),
    ];
    const moves = propagateCategory({ id: 'a' as ProductId, kind: 'café moulu' }, 'c-mine' as CategoryId, list);
    expect(moves.map((m) => m.productId)).toEqual(['b']);
  });

  it('sends member corrections as examples and skips classified products', () => {
    const list = [p('a', { kind: 'café moulu', kindSource: 'user' }), p('b'), p('c', { kind: 'thé' })];
    expect(householdExamples(list, categories)).toEqual([{ name: 'a', kind: 'café moulu', categoryKey: null }]);
    expect(pendingClassification(list, new Set()).map((x) => x.id)).toEqual(['b']);
  });
});
