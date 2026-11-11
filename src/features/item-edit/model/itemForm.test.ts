import { describe, expect, it } from 'vitest';
import type { Product } from '@/domain/types';
import {
  formFromProduct,
  itemFormDiff,
  matchingProducts,
  parseDecimal,
  priceToCents,
  sizeForDisplay,
  sizeToStored,
  validateItemForm,
} from './itemForm';

const product = (o: Partial<Product> = {}): Product =>
  ({
    id: 'p1',
    householdId: 'h',
    name: 'Huile d’olive',
    brand: 'Puget',
    gtin: null,
    catalogGtin: null,
    categoryId: 'c1',
    netQuantity: 1000,
    netUnit: 'ml',
    packCount: null,
    priceCents: 899,
    priceSource: 'user',
    minQuantity: null,
    usualQuantity: null,
    lowAlert: true,
    imageUrl: null,
    kind: null,
    kindSource: null,
    categorySource: null,
    suggestedMin: null,
    createdAt: '',
    updatedAt: '',
    deletedAt: null,
    ...o,
  }) as Product;

describe('parsing', () => {
  it('accepts a comma or a dot, rejects text', () => {
    expect(parseDecimal('1,5')).toBe(1.5);
    expect(parseDecimal(' 2.25 ')).toBe(2.25);
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('abc')).toBeNaN();
    expect(parseDecimal('1,2,3')).toBeNaN();
  });

  it('converts prices to cents and sizes to stored units', () => {
    expect(priceToCents('1,89')).toBe(189);
    expect(priceToCents('')).toBeNull();
    expect(sizeToStored('1,5', 'kg')).toEqual({ netQuantity: 1500, netUnit: 'g' });
    expect(sizeToStored('75', 'cl')).toEqual({ netQuantity: 750, netUnit: 'ml' });
    expect(sizeToStored('0', 'g')).toEqual({ netQuantity: null, netUnit: null });
  });

  it('shows stored sizes in the natural unit', () => {
    expect(sizeForDisplay(1500, 'g')).toEqual({ size: '1,5', unit: 'kg' });
    expect(sizeForDisplay(750, 'ml')).toEqual({ size: '75', unit: 'cl' });
    expect(sizeForDisplay(1000, 'ml')).toEqual({ size: '1', unit: 'l' });
    expect(sizeForDisplay(333, 'ml')).toEqual({ size: '333', unit: 'ml' });
    expect(sizeForDisplay(null, null)).toEqual({ size: '', unit: 'g' });
  });
});

describe('validateItemForm', () => {
  const others = [
    { id: 'p1', name: 'Huile d’olive' },
    { id: 'p2', name: 'Crème fraîche' },
  ] as Pick<Product, 'id' | 'name'>[];
  const base = { name: 'Huile d’olive', size: '1', price: '8,99' };

  it('requires a name', () => {
    expect(validateItemForm({ ...base, name: '  ' }, others, 'p1')).toEqual({ name: 'required' });
  });

  it('refuses another product’s name, ignoring case and accents', () => {
    expect(validateItemForm({ ...base, name: 'creme FRAICHE' }, others, 'p1')).toEqual({ name: 'taken' });
    expect(validateItemForm(base, others, 'p1')).toEqual({});
  });

  it('requires a positive size and a non-negative price when given', () => {
    expect(validateItemForm({ ...base, size: '0' }, others, 'p1')).toEqual({ size: 'positive' });
    expect(validateItemForm({ ...base, price: '-1' }, others, 'p1')).toEqual({ price: 'positive' });
    expect(validateItemForm({ ...base, size: '', price: '' }, others, 'p1')).toEqual({});
  });
});

describe('itemFormDiff', () => {
  it('is empty for an unchanged form', () => {
    const p = product();
    expect(itemFormDiff(p, formFromProduct(p))).toEqual({});
  });

  it('sends only changed fields, with the price source', () => {
    const p = product();
    const form = { ...formFromProduct(p), brand: '', price: '9,49', size: '75', unit: 'cl' as const };
    expect(itemFormDiff(p, form)).toEqual({
      brand: null,
      netQuantity: 750,
      netUnit: 'ml',
      priceCents: 949,
      priceSource: 'user',
    });
  });

  it('resets the usual quantity to computed with null', () => {
    const p = product({ usualQuantity: 4 });
    expect(itemFormDiff(p, { ...formFromProduct(p), usualQuantity: null })).toEqual({ usualQuantity: null });
  });
});

describe('matchingProducts', () => {
  it('matches every word, accent-insensitive, up to the limit', () => {
    const list = [{ name: 'Pâtes complètes' }, { name: 'Pâté de campagne' }, { name: 'Riz' }];
    expect(matchingProducts('pate', list).map((p) => p.name)).toEqual(['Pâtes complètes', 'Pâté de campagne']);
    expect(matchingProducts('pate comp', list).map((p) => p.name)).toEqual(['Pâtes complètes']);
    expect(matchingProducts('', list)).toEqual([]);
    expect(matchingProducts('pate', list, 1)).toHaveLength(1);
  });
});
