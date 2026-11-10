import { describe, expect, it } from 'vitest';
import {
  parseAuthCallbackSearch,
  parseGlobalSearch,
  parseJoinSearch,
  parseQueryString,
  parseStockSearch,
  stringifyQuery,
  withoutOverlays,
} from './search';

describe('parseGlobalSearch', () => {
  it('accepts known sheets and drops unknown ones', () => {
    expect(parseGlobalSearch({ sheet: 'sync' })).toEqual({ sheet: 'sync' });
    expect(parseGlobalSearch({ sheet: 'nope' })).toEqual({});
  });

  it('keeps settings pages only under the settings sheet', () => {
    expect(parseGlobalSearch({ sheet: 'settings', page: 'account' })).toEqual({ sheet: 'settings', page: 'account' });
    expect(parseGlobalSearch({ sheet: 'sync', page: 'account' })).toEqual({ sheet: 'sync' });
    expect(parseGlobalSearch({ sheet: 'settings', page: 'member', id: 'u1' })).toEqual({
      sheet: 'settings',
      page: 'member',
      id: 'u1',
    });
  });

  it('drops row sheets without a valid id', () => {
    expect(parseGlobalSearch({ sheet: 'item-edit' })).toEqual({});
    expect(parseGlobalSearch({ sheet: 'item-edit', id: '../x' })).toEqual({});
    expect(parseGlobalSearch({ sheet: 'item-edit', id: 'p1', step: 'category' })).toEqual({
      sheet: 'item-edit',
      id: 'p1',
      step: 'category',
    });
    expect(parseGlobalSearch({ sheet: 'recount', id: 'p1', pantry: 'c1' })).toEqual({
      sheet: 'recount',
      id: 'p1',
      pantry: 'c1',
    });
  });

  it('defaults the scanner mode to add', () => {
    expect(parseGlobalSearch({ cover: 'scan' })).toEqual({ cover: 'scan', mode: 'add' });
    expect(parseGlobalSearch({ cover: 'scan', mode: 'withdraw' })).toEqual({ cover: 'scan', mode: 'withdraw' });
    expect(parseGlobalSearch({ mode: 'withdraw' })).toEqual({});
  });

  it('validates confirm ids', () => {
    expect(parseGlobalSearch({ confirm: 'delete-item' })).toEqual({ confirm: 'delete-item' });
    expect(parseGlobalSearch({ confirm: '<script>' })).toEqual({});
  });

  it('removes every overlay param', () => {
    expect(withoutOverlays({ sheet: 'sync', cover: 'scan', mode: 'add', group: 'price' })).toEqual({ group: 'price' });
  });
});

describe('route search params', () => {
  it('omits stock defaults so the canonical URL stays bare', () => {
    expect(parseStockSearch({ group: 'category', sort: 'name', dir: 'asc' })).toEqual({});
    expect(parseStockSearch({ group: 'price', sort: 'recent', dir: 'desc' })).toEqual({
      group: 'price',
      sort: 'recent',
      dir: 'desc',
    });
    expect(parseStockSearch({ group: 'bogus' })).toEqual({});
  });

  it('parses the join prefill and the OAuth callback', () => {
    expect(parseJoinSearch({ code: 'K7PM-4QXD' })).toEqual({ code: 'K7PM-4QXD' });
    expect(parseJoinSearch({})).toEqual({});
    expect(parseAuthCallbackSearch({ code: 'abc', state: 'x' })).toEqual({ code: 'abc' });
    expect(parseAuthCallbackSearch({ error: 'access_denied' })).toEqual({ error: 'access_denied' });
  });
});

describe('query codec', () => {
  it('round-trips plain strings', () => {
    const search = { sheet: 'item-edit', id: 'p 1', empty: '', none: undefined };
    const qs = stringifyQuery(search);
    expect(qs).toBe('?sheet=item-edit&id=p+1');
    expect(parseQueryString(qs)).toEqual({ sheet: 'item-edit', id: 'p 1' });
    expect(stringifyQuery({})).toBe('');
  });

  it('keeps the first value of a repeated key', () => {
    expect(parseQueryString('a=1&a=2')).toEqual({ a: '1' });
  });
});
