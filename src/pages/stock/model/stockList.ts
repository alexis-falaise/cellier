/**
 * Stock list derivations (design 03 §4.5): the items of the current scope, sorted and grouped into
 * the flat row model the virtual list renders. Pure functions; the page memoises them.
 */
import type { SortDirection, StockGroup, StockSort } from '@/app/search';
import { fold } from '@/shared/i18n/text';

/** One product as the Stock list sees it in the current scope (one cellier or all). */
export interface StockItem {
  id: string;
  name: string;
  /** Category id (null = «Sans catégorie»), its display order and name. */
  categoryId: string | null;
  categoryOrder: number;
  categoryName: string | null;
  /** Quantity in the scope: the cellier's row, or the household total. */
  quantity: number;
  /** Unit price in cents, null when unknown. */
  priceCents: number | null;
  /** Epoch ms of the latest addition to stock, null when never added. */
  lastAddedAt: number | null;
  low: boolean;
}

export interface StockViewOptions {
  group: StockGroup;
  sort: StockSort;
  dir: SortDirection;
  showEmpty: boolean;
}

/** Group titles, injected so the derivation stays free of the catalogue. */
export interface GroupLabels {
  noCategory: string;
  added: { today: string; week: string; month: string; older: string };
  price: { lt2: string; from2to5: string; from5to10: string; gt10: string; unknown: string };
  quantity: { zero: string; one: string; from2to5: string; from6to11: string; from12: string };
}

export type StockHeaderRow = { kind: 'header'; key: string; title: string; count: number | null; first: boolean };
export type StockItemRow<T extends StockItem = StockItem> = {
  kind: 'item';
  key: string;
  item: T;
  first: boolean;
  last: boolean;
};
export type StockRow<T extends StockItem = StockItem> = StockHeaderRow | StockItemRow<T>;

export interface StockRows<T extends StockItem = StockItem> {
  rows: StockRow<T>[];
  /** Items shown (the footer's «{n} articles»). */
  itemCount: number;
  /** Sum of their quantities (the footer's «{u} unités»). */
  unitCount: number;
}

const nameCollator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });

export const compareNames = (a: string, b: string): number => nameCollator.compare(a, b);

/** «Catégorie» is not offered as a sort while grouping by category; it falls back to the name. */
export function effectiveSort(group: StockGroup, sort: StockSort): StockSort {
  return group === 'category' && sort === 'category' ? 'name' : sort;
}

/** Puts nulls last whatever the direction. */
function nullsLast(a: number | null, b: number | null, natural: (x: number, y: number) => number, sign: number) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return sign * natural(a, b);
}

/**
 * Comparator for a sort option. Each option has a natural direction (`asc`): name A→Z, category
 * in household order, latest addition first, highest price first, lowest quantity first; `desc`
 * reverses it. Unknown prices and never-added items stay last in both directions. Ties: name.
 */
export function stockComparator(sort: StockSort, dir: SortDirection): (a: StockItem, b: StockItem) => number {
  const sign = dir === 'asc' ? 1 : -1;
  const byName = (a: StockItem, b: StockItem) => compareNames(a.name, b.name) || a.id.localeCompare(b.id);
  switch (sort) {
    case 'name':
      return (a, b) => sign * compareNames(a.name, b.name) || a.id.localeCompare(b.id);
    case 'category':
      return (a, b) =>
        sign * (a.categoryOrder - b.categoryOrder || compareNames(a.categoryName ?? '', b.categoryName ?? '')) ||
        byName(a, b);
    case 'recent':
      return (a, b) => nullsLast(a.lastAddedAt, b.lastAddedAt, (x, y) => y - x, sign) || byName(a, b);
    case 'price':
      return (a, b) => nullsLast(a.priceCents, b.priceCents, (x, y) => y - x, sign) || byName(a, b);
    case 'quantity':
      return (a, b) => sign * (a.quantity - b.quantity) || byName(a, b);
  }
}

interface GroupKey {
  key: string;
  title: string;
  order: number;
}

function startOfDay(t: number): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Monday 00:00 of the week of `t` (local time). */
function startOfWeek(t: number): number {
  const d = new Date(startOfDay(t));
  const weekday = (d.getDay() + 6) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - weekday).getTime();
}

function startOfMonth(t: number): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

/** «Aujourd’hui», «Cette semaine», «Ce mois-ci», «Plus ancien» (03 §4.5.3). */
export function addedBucket(lastAddedAt: number | null, now: number): 'today' | 'week' | 'month' | 'older' {
  if (lastAddedAt === null) return 'older';
  if (lastAddedAt >= startOfDay(now)) return 'today';
  if (lastAddedAt >= startOfWeek(now)) return 'week';
  if (lastAddedAt >= startOfMonth(now)) return 'month';
  return 'older';
}

export function priceBucket(cents: number | null): 'lt2' | 'from2to5' | 'from5to10' | 'gt10' | 'unknown' {
  if (cents === null) return 'unknown';
  if (cents < 200) return 'lt2';
  if (cents < 500) return 'from2to5';
  if (cents < 1000) return 'from5to10';
  return 'gt10';
}

export function quantityBucket(quantity: number): 'zero' | 'one' | 'from2to5' | 'from6to11' | 'from12' {
  if (quantity <= 0) return 'zero';
  if (quantity === 1) return 'one';
  if (quantity <= 5) return 'from2to5';
  if (quantity <= 11) return 'from6to11';
  return 'from12';
}

const ADDED_ORDER = ['today', 'week', 'month', 'older'] as const;
const PRICE_ORDER = ['lt2', 'from2to5', 'from5to10', 'gt10', 'unknown'] as const;
const QTY_ORDER = ['zero', 'one', 'from2to5', 'from6to11', 'from12'] as const;

/** Index letter of a name: «É» → «E», digits and symbols → «#». */
export function indexLetter(name: string): string {
  const first = fold(name.trim()).charAt(0).toUpperCase();
  return first >= 'A' && first <= 'Z' ? first : '#';
}

function groupOf(item: StockItem, group: StockGroup, labels: GroupLabels, now: number): GroupKey | null {
  switch (group) {
    case 'item':
      return null;
    case 'category':
      return item.categoryId === null
        ? { key: 'cat:none', title: labels.noCategory, order: Number.MAX_SAFE_INTEGER }
        : { key: `cat:${item.categoryId}`, title: item.categoryName ?? labels.noCategory, order: item.categoryOrder };
    case 'added': {
      const b = addedBucket(item.lastAddedAt, now);
      return { key: `added:${b}`, title: labels.added[b], order: ADDED_ORDER.indexOf(b) };
    }
    case 'price': {
      const b = priceBucket(item.priceCents);
      return { key: `price:${b}`, title: labels.price[b], order: PRICE_ORDER.indexOf(b) };
    }
    case 'quantity': {
      const b = quantityBucket(item.quantity);
      return { key: `qty:${b}`, title: labels.quantity[b], order: QTY_ORDER.indexOf(b) };
    }
  }
}

function pushSection<T extends StockItem>(
  rows: StockRow<T>[],
  header: Omit<StockHeaderRow, 'kind' | 'first'> | null,
  items: T[],
) {
  if (items.length === 0) return;
  if (header) rows.push({ kind: 'header', ...header, first: rows.length === 0 });
  items.forEach((item, i) => {
    rows.push({ kind: 'item', key: `item:${item.id}`, item, first: i === 0, last: i === items.length - 1 });
  });
}

/**
 * Flat rows for the virtual list. With `searchIds` (search active): one flat section in relevance
 * order, no grouping, empty items included. Otherwise: `showEmpty` filter, sort, then sections.
 */
export function buildStockRows<T extends StockItem>(
  items: readonly T[],
  options: StockViewOptions,
  labels: GroupLabels,
  now: number,
  searchIds: readonly string[] | null = null,
): StockRows<T> {
  const rows: StockRow<T>[] = [];
  let visible: T[];
  if (searchIds) {
    const byId = new Map(items.map((i) => [i.id, i]));
    visible = searchIds.map((id) => byId.get(id)).filter((i): i is T => i !== undefined);
    pushSection(rows, null, visible);
  } else {
    visible = options.showEmpty ? [...items] : items.filter((i) => i.quantity > 0);
    const sort = effectiveSort(options.group, options.sort);
    visible.sort(stockComparator(sort, options.dir));
    if (options.group === 'item') {
      if (sort === 'name') {
        const sections = new Map<string, T[]>();
        for (const item of visible) {
          const letter = indexLetter(item.name);
          const list = sections.get(letter);
          if (list) list.push(item);
          else sections.set(letter, [item]);
        }
        for (const [letter, list] of sections) {
          pushSection(rows, { key: `letter:${letter}`, title: letter, count: null }, list);
        }
      } else {
        pushSection(rows, null, visible);
      }
    } else {
      const sections = new Map<string, { group: GroupKey; items: T[] }>();
      for (const item of visible) {
        const g = groupOf(item, options.group, labels, now) as GroupKey;
        const section = sections.get(g.key);
        if (section) section.items.push(item);
        else sections.set(g.key, { group: g, items: [item] });
      }
      const ordered = [...sections.values()].sort(
        (a, b) => a.group.order - b.group.order || compareNames(a.group.title, b.group.title),
      );
      for (const { group, items: list } of ordered) {
        pushSection(rows, { key: `h:${group.key}`, title: group.title, count: list.length }, list);
      }
    }
  }
  return {
    rows,
    itemCount: visible.length,
    unitCount: visible.reduce((sum, i) => sum + Math.max(0, i.quantity), 0),
  };
}
