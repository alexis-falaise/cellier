/**
 * Typed navigation for screens and features. Nobody writes search params by hand:
 *
 *   openSheet({ sheet: 'settings' });                     pushSheetPage({ page: 'member', id });
 *   openSheet({ sheet: 'item-edit', id: productId });     closeSheet();   // all pushes at once
 *   openConfirm('delete-item');                            closeConfirm();
 *   openScanner('withdraw', buttonRect);                   closeScanner();
 *   pushItem(productId); pushItemHistory(productId); pushActivity(); goBack();
 *
 *   const overlay = useOverlay();   // typed GlobalSearch of the current location
 *   const screen = useScreen();     // the stack screen a page is rendered in (productId, search)
 *
 * Sheets live in search params so the system Back closes them (design 03 §1.3). Each sheet push is
 * a history entry; `closeSheet` removes them all with one `history.go(-depth)`.
 */
import type { AnyRouter } from '@tanstack/react-router';
import { useRouterState } from '@tanstack/react-router';
import { createContext, useContext } from 'react';
import {
  type GlobalSearch,
  parseGlobalSearch,
  type ScanMode,
  type SettingsPage,
  type SheetStep,
  withoutOverlays,
} from './search';
import { itemPath, type StackEntry, stackFor, TAB_ROOTS, type TabKey, tabOf } from './stack';

export type { GlobalSearch, ScanMode, SettingsPage, SheetName, SheetStep } from './search';
export type { StackEntry, TabKey } from './stack';

let router: AnyRouter | null = null;

/** Called once by src/app/router.tsx. */
export function bindNavigationRouter(instance: AnyRouter): void {
  router = instance;
}

function r(): AnyRouter {
  if (!router) throw new Error('Navigation used before the router was created.');
  return router;
}

interface NavState {
  __TSR_index?: number;
  /** History index of the entry under the open sheet. */
  cellierSheetBase?: number | undefined;
  cellierConfirmBase?: number | undefined;
  cellierCoverBase?: number | undefined;
}

function navState(): NavState {
  return (r().history.location.state ?? {}) as NavState;
}

function index(): number {
  return navState().__TSR_index ?? 0;
}

function location() {
  return r().state.location;
}

function rawSearch(): Record<string, unknown> {
  return (location().search ?? {}) as Record<string, unknown>;
}

function go(search: Record<string, unknown>, options: { replace?: boolean; state?: Partial<NavState> } = {}) {
  const keep = navState();
  const state: NavState = {
    ...(keep.cellierSheetBase !== undefined ? { cellierSheetBase: keep.cellierSheetBase } : {}),
    ...(keep.cellierConfirmBase !== undefined ? { cellierConfirmBase: keep.cellierConfirmBase } : {}),
    ...(keep.cellierCoverBase !== undefined ? { cellierCoverBase: keep.cellierCoverBase } : {}),
    ...options.state,
  };
  void r().navigate({
    to: location().pathname,
    search: search,
    replace: options.replace ?? false,
    state: state as never,
  } as never);
}

function clean(search: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(search)) if (v !== undefined) out[k] = v;
  return out;
}

const SHEET_KEYS = ['sheet', 'page', 'id', 'step', 'pantry', 'confirm'] as const;

function omit(search: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const copy = { ...search };
  for (const k of keys) delete copy[k];
  return copy;
}

// ---------------------------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------------------------

export type SheetTarget =
  | { sheet: 'pantries' | 'stock-view' | 'put-away' | 'notify' | 'install' | 'sync' }
  | { sheet: 'new-item'; step?: SheetStep }
  | { sheet: 'settings'; page?: SettingsPage; id?: string }
  | { sheet: 'item-edit'; id: string; step?: SheetStep }
  | { sheet: 'recount'; id: string; pantry?: string }
  | { sheet: 'item-move'; id: string };

/** Opens a sheet over the current screen (replacing any open sheet). */
export function openSheet(target: SheetTarget): void {
  const base = omit(rawSearch(), SHEET_KEYS);
  const alreadyOpen = parseGlobalSearch(rawSearch()).sheet !== undefined;
  go(clean({ ...base, ...target }), {
    replace: alreadyOpen,
    state: alreadyOpen ? {} : { cellierSheetBase: index() },
  });
}

/** A push inside the open sheet (Réglages pages, category step): one history entry, Back pops it. */
export function pushSheetPage(patch: { page?: SettingsPage; id?: string; step?: SheetStep }): void {
  const current = parseGlobalSearch(rawSearch());
  if (!current.sheet) return;
  const base = omit(rawSearch(), ['page', 'id', 'step', 'confirm']);
  const keepId = current.sheet !== 'settings' ? { id: current.id } : {};
  go(clean({ ...base, ...keepId, ...patch }));
}

/** Pops the top push inside the sheet (the sheet header's back chevron). */
export function popSheetPage(): void {
  r().history.back();
}

/** Closes the sheet and all of its pushes in one step, so Back afterwards does not reopen it. */
export function closeSheet(): void {
  const base = navState().cellierSheetBase;
  const depth = base === undefined ? 0 : index() - base;
  if (depth > 0) {
    r().history.go(-depth);
    return;
  }
  go(omit(rawSearch(), SHEET_KEYS), { replace: true, state: { cellierSheetBase: undefined } });
}

// ---------------------------------------------------------------------------------------------
// Confirmation dialogs (`&confirm=<id>`, over a screen or a sheet)
// ---------------------------------------------------------------------------------------------

export function openConfirm(id: string): void {
  go({ ...rawSearch(), confirm: id }, { state: { cellierConfirmBase: index() } });
}

export function closeConfirm(): void {
  const base = navState().cellierConfirmBase;
  if (base !== undefined && index() > base) {
    r().history.go(base - index());
    return;
  }
  go(omit(rawSearch(), ['confirm']), { replace: true });
}

// ---------------------------------------------------------------------------------------------
// Scanner cover (`?cover=scan&mode=add|withdraw`)
// ---------------------------------------------------------------------------------------------

let scanOrigin: DOMRect | null = null;

/** Opens ScannerCover. Call `primeCamera()` in the same user gesture first (the shell does). */
export function openScanner(mode: ScanMode, origin?: DOMRect): void {
  scanOrigin = origin ?? null;
  const base = omit(rawSearch(), ['cover', 'mode', ...SHEET_KEYS]);
  go({ ...base, cover: 'scan', mode }, { state: { cellierCoverBase: index(), cellierSheetBase: undefined } });
}

/** Rect of the scan button the cover grows from (null when opened another way). */
export function getScannerOrigin(): DOMRect | null {
  return scanOrigin;
}

export function closeScanner(): void {
  const base = navState().cellierCoverBase;
  if (base !== undefined && index() > base) {
    r().history.go(base - index());
    return;
  }
  go(omit(rawSearch(), ['cover', 'mode']), { replace: true });
}

// ---------------------------------------------------------------------------------------------
// Pushes and tabs
// ---------------------------------------------------------------------------------------------

function currentTab(): TabKey {
  return tabOf(location().pathname) ?? 'home';
}

function push(pathname: string, options: { replace?: boolean } = {}): void {
  void r().navigate({ to: pathname, replace: options.replace ?? false } as never);
}

/** Item detail in the current tab's stack (Accueil, Stock or Courses). */
export function pushItem(productId: string, tab: TabKey = currentTab()): void {
  push(itemPath(tab, productId));
}

export function pushItemHistory(productId: string, tab: TabKey = currentTab()): void {
  push(`${itemPath(tab, productId)}/history`);
}

export function pushActivity(): void {
  push('/activity');
}

/**
 * Back button of a pushed screen: pops when there is in-app history, otherwise (opened from a
 * notification) goes to the tab root with `replace` (design 03 §1.4).
 */
export function goBack(): void {
  if (index() > 0) {
    r().history.back();
    return;
  }
  push(TAB_ROOTS[currentTab()], { replace: true });
}

/** Any in-app path (notification taps, «Retour à l’accueil»). */
export function navigateTo(path: string, options: { replace?: boolean } = {}): void {
  push(path, options);
}

const tabLocations = new Map<TabKey, string>();

/** Remembers the last location of a tab without its overlays (the shell calls it). */
export function rememberTabLocation(pathname: string, search: Record<string, unknown>): void {
  const tab = tabOf(pathname);
  if (!tab) return;
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(withoutOverlays(search))) {
    if (typeof v === 'string' && v !== '') query.set(k, v);
  }
  const qs = query.toString();
  tabLocations.set(tab, qs ? `${pathname}?${qs}` : pathname);
}

/** Tab bar selection: restores the tab's last location; on the active tab, pops to its root. */
export function selectTab(tab: TabKey): 'switched' | 'popped' | 'at-root' {
  const path = location().pathname;
  if (tabOf(path) === tab) {
    const stack = stackFor(path);
    if (stack && stack.entries.length > 1) {
      push(TAB_ROOTS[tab], { replace: true });
      return 'popped';
    }
    return 'at-root';
  }
  void r().navigate({ href: tabLocations.get(tab) ?? TAB_ROOTS[tab] } as never);
  return 'switched';
}

// ---------------------------------------------------------------------------------------------
// Unsaved edits (navigation from a notification and the update toast wait for them)
// ---------------------------------------------------------------------------------------------

const unsaved = new Set<string>();

/** Sheets with a form call this while they hold unsaved edits. */
export function setUnsavedChanges(key: string, dirty: boolean): void {
  if (dirty) unsaved.add(key);
  else unsaved.delete(key);
}

export function hasUnsavedChanges(): boolean {
  return unsaved.size > 0;
}

// ---------------------------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------------------------

/** Typed overlay params (sheet, page, id, step, pantry, confirm, cover, mode) of the current location. */
export function useOverlay(): GlobalSearch {
  const search = useRouterState({ select: (s) => s.location.search as Record<string, unknown> });
  return parseGlobalSearch(search);
}

export interface ScreenInfo {
  entry: StackEntry;
  tab: TabKey;
  /** Search params of this screen (frozen while another screen is pushed over it). */
  search: Record<string, unknown>;
  /** True for the top screen of the visible tab. */
  active: boolean;
}

export const ScreenContext = createContext<ScreenInfo | null>(null);

/** The stack screen a page is rendered in. Pages read their `productId` here, not from the router. */
export function useScreen(): ScreenInfo | null {
  return useContext(ScreenContext);
}
