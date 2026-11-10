/**
 * Stock display choices (design 03 §4.5.3): «Defaults are not written to the URL; choices persist
 * per device». The URL wins when it names an option; otherwise the device's last choice; otherwise
 * the design default. «Afficher les épuisés» lives only here (it is not a URL param).
 */
import { useSyncExternalStore } from 'react';
import {
  type SortDirection,
  STOCK_DEFAULTS,
  STOCK_GROUPS,
  STOCK_SORTS,
  type StockGroup,
  type StockSearch,
  type StockSort,
} from '@/app/search';
import type { StockViewOptions } from './stockList';

const KEY = 'cellier:stock-view';

export interface StoredStockView {
  group?: StockGroup;
  sort?: StockSort;
  dir?: SortDirection;
  showEmpty?: boolean;
}

const listeners = new Set<() => void>();
let cached: StoredStockView | null = null;

export function parseStoredView(raw: unknown): StoredStockView {
  const out: StoredStockView = {};
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  if ((STOCK_GROUPS as readonly unknown[]).includes(r.group)) out.group = r.group as StockGroup;
  if ((STOCK_SORTS as readonly unknown[]).includes(r.sort)) out.sort = r.sort as StockSort;
  if (r.dir === 'asc' || r.dir === 'desc') out.dir = r.dir;
  if (typeof r.showEmpty === 'boolean') out.showEmpty = r.showEmpty;
  return out;
}

export function readStockView(): StoredStockView {
  if (cached) return cached;
  try {
    cached = parseStoredView(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    cached = {};
  }
  return cached;
}

export function writeStockView(patch: StoredStockView): void {
  cached = { ...readStockView(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(cached));
  } catch {
    // memory only
  }
  for (const l of [...listeners]) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const EMPTY: StoredStockView = {};

export function useStoredStockView(): StoredStockView {
  return useSyncExternalStore(subscribe, readStockView, () => EMPTY);
}

/** URL param, else the device's choice, else the design default. */
export function resolveStockView(url: StockSearch, stored: StoredStockView): StockViewOptions {
  return {
    group: url.group ?? stored.group ?? STOCK_DEFAULTS.group,
    sort: url.sort ?? stored.sort ?? STOCK_DEFAULTS.sort,
    dir: url.dir ?? stored.dir ?? STOCK_DEFAULTS.dir,
    showEmpty: stored.showEmpty ?? true,
  };
}

/** The URL params for a view: defaults are omitted. */
export function stockViewParams(view: Pick<StockViewOptions, 'group' | 'sort' | 'dir'>): StockSearch {
  const out: StockSearch = {};
  if (view.group !== STOCK_DEFAULTS.group) out.group = view.group;
  if (view.sort !== STOCK_DEFAULTS.sort) out.sort = view.sort;
  if (view.dir !== STOCK_DEFAULTS.dir) out.dir = view.dir;
  return out;
}
