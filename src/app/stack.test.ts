import { describe, expect, it } from 'vitest';
import { itemPath, stackFor, tabOf } from './stack';

const keys = (pathname: string) => stackFor(pathname)?.entries.map((e) => e.key) ?? null;

describe('stackFor', () => {
  it('maps tab roots', () => {
    expect(stackFor('/')).toMatchObject({ tab: 'home', entries: [{ routeId: '/_tabs/' }] });
    expect(stackFor('/stock')).toMatchObject({ tab: 'stock', entries: [{ routeId: '/_tabs/stock/' }] });
    expect(stackFor('/groceries/')).toMatchObject({ tab: 'groceries', entries: [{ routeId: '/_tabs/groceries/' }] });
  });

  it('builds the pushed screens under their tab root', () => {
    expect(keys('/activity')).toEqual(['/', '/activity']);
    expect(keys('/stock/items/p1')).toEqual(['/stock', '/stock/items/p1']);
    expect(keys('/groceries/items/p1/history')).toEqual([
      '/groceries',
      '/groceries/items/p1',
      '/groceries/items/p1/history',
    ]);
    const top = stackFor('/items/p%201/history')?.entries.at(-1);
    expect(top).toMatchObject({ kind: 'history', routeId: '/_tabs/items/$productId/history', productId: 'p 1' });
  });

  it('returns null outside the tab routes', () => {
    expect(stackFor('/welcome')).toBeNull();
    expect(stackFor('/items')).toBeNull();
    expect(stackFor('/stock/items/p1/edit')).toBeNull();
    expect(tabOf('/onboarding/join')).toBeNull();
  });

  it('builds item paths per tab', () => {
    expect(itemPath('home', 'a/b')).toBe('/items/a%2Fb');
    expect(itemPath('stock', 'p1')).toBe('/stock/items/p1');
    expect(tabOf(itemPath('groceries', 'p1'))).toBe('groceries');
  });
});
