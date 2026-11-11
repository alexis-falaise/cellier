/**
 * Tab stacks (design 03 §1.2–1.3). The router matches one leaf route; the shell renders the whole
 * stack of that tab (root, item detail, history) so pushes and pops animate between mounted
 * screens. `stackFor` derives that stack from the pathname alone.
 */

export type TabKey = 'home' | 'stock' | 'groceries';

export type ScreenKind = 'home' | 'activity' | 'value' | 'stock' | 'groceries' | 'item' | 'history';

export interface StackEntry {
  /** Stable key: the screen's pathname. */
  key: string;
  kind: ScreenKind;
  /** File-route id rendering this screen (see src/app/routes/_tabs/). */
  routeId: string;
  pathname: string;
  productId?: string;
}

export interface TabStack {
  tab: TabKey;
  entries: StackEntry[];
}

export const TAB_ROOTS: Record<TabKey, string> = { home: '/', stock: '/stock', groceries: '/groceries' };

/** Item routes per tab: Accueil `/items/…`, Stock `/stock/items/…`, Courses `/groceries/items/…`. */
export const ITEM_PREFIX: Record<TabKey, string> = {
  home: '/items',
  stock: '/stock/items',
  groceries: '/groceries/items',
};

const ROOT_ROUTE: Record<TabKey, { kind: ScreenKind; routeId: string }> = {
  home: { kind: 'home', routeId: '/_tabs/' },
  stock: { kind: 'stock', routeId: '/_tabs/stock/' },
  groceries: { kind: 'groceries', routeId: '/_tabs/groceries/' },
};

const ITEM_ROUTE: Record<TabKey, string> = {
  home: '/_tabs/items/$productId/',
  stock: '/_tabs/stock/items/$productId/',
  groceries: '/_tabs/groceries/items/$productId/',
};

const HISTORY_ROUTE: Record<TabKey, string> = {
  home: '/_tabs/items/$productId/history',
  stock: '/_tabs/stock/items/$productId/history',
  groceries: '/_tabs/groceries/items/$productId/history',
};

function normalise(pathname: string): string {
  const p = pathname.replace(/\/{2,}/g, '/');
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** The tab a pathname belongs to, or null outside the tab routes. */
export function tabOf(pathname: string): TabKey | null {
  return stackFor(pathname)?.tab ?? null;
}

export function stackFor(pathname: string): TabStack | null {
  const path = normalise(pathname);
  const parts = path.split('/').filter(Boolean);
  let tab: TabKey;
  let rest: string[];
  if (parts[0] === 'stock' || parts[0] === 'groceries') {
    tab = parts[0];
    rest = parts.slice(1);
  } else {
    tab = 'home';
    rest = parts;
  }
  const root = ROOT_ROUTE[tab];
  const entries: StackEntry[] = [
    { key: TAB_ROOTS[tab], kind: root.kind, routeId: root.routeId, pathname: TAB_ROOTS[tab] },
  ];
  if (rest.length === 0) return { tab, entries };
  if (tab === 'home' && rest.length === 1 && rest[0] === 'activity') {
    entries.push({ key: '/activity', kind: 'activity', routeId: '/_tabs/activity', pathname: '/activity' });
    return { tab, entries };
  }
  if (tab === 'home' && rest.length === 1 && rest[0] === 'value') {
    entries.push({ key: '/value', kind: 'value', routeId: '/_tabs/value', pathname: '/value' });
    return { tab, entries };
  }
  if (rest[0] !== 'items' || rest.length < 2 || rest.length > 3) return null;
  const rawId = rest[1] as string;
  const productId = decode(rawId);
  const itemPath = `${ITEM_PREFIX[tab]}/${rawId}`;
  entries.push({ key: itemPath, kind: 'item', routeId: ITEM_ROUTE[tab], pathname: itemPath, productId });
  if (rest.length === 3) {
    if (rest[2] !== 'history') return null;
    const historyPath = `${itemPath}/history`;
    entries.push({ key: historyPath, kind: 'history', routeId: HISTORY_ROUTE[tab], pathname: historyPath, productId });
  }
  return { tab, entries };
}

/** Pathname of the item detail screen in a tab's stack. */
export function itemPath(tab: TabKey, productId: string): string {
  return `${ITEM_PREFIX[tab]}/${encodeURIComponent(productId)}`;
}
