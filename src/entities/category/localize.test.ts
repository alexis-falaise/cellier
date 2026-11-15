import { afterEach, describe, expect, it } from 'vitest';
import type { Category, CategoryId, HouseholdId, IsoDateTime } from '@/domain/types';
import { setActiveLocale } from '@/shared/i18n';
import { localizeCategory } from './localize';

const at = '2026-11-15T10:00:00.000Z' as IsoDateTime;
const category = (patch: Partial<Category>): Category => ({
  id: 'c1' as CategoryId,
  householdId: 'h1' as HouseholdId,
  templateKey: 'laitier',
  name: 'Produits laitiers & œufs',
  icon: null,
  color: null,
  sortOrder: 60,
  createdAt: at,
  updatedAt: at,
  deletedAt: null,
  ...patch,
});

afterEach(() => setActiveLocale('fr'));

describe('localizeCategory', () => {
  it('leaves French as stored', () => {
    const row = category({});
    expect(localizeCategory(row)).toBe(row);
  });

  it('names an untouched default category in the member’s language', () => {
    const row = category({});
    setActiveLocale('en');
    expect(localizeCategory(row).name).toBe('Dairy & eggs');
    setActiveLocale('sv');
    expect(localizeCategory(category({ templateKey: 'autre', name: 'Autre' })).name).toBe('Övrigt');
  });

  it('keeps a renamed default and a custom category', () => {
    setActiveLocale('en');
    const renamed = category({ name: 'Crèmerie' });
    const custom = category({ templateKey: null, name: 'Produits laitiers & œufs' });
    expect(localizeCategory(renamed)).toBe(renamed);
    expect(localizeCategory(custom)).toBe(custom);
  });

  it('gives the same object for the same row, so selectors stay stable', () => {
    setActiveLocale('sv');
    const row = category({});
    expect(localizeCategory(row)).toBe(localizeCategory(row));
    expect(localizeCategory(row)).not.toBe(row);
  });
});
