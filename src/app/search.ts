/**
 * Search-param schema (design 03 §1.5). The router parses the query string into plain strings
 * (src/app/router.tsx); these validators turn them into typed, normalised objects and drop anything
 * unknown or inconsistent (a `page` without `sheet=settings`, a `mode` without `cover=scan`, …).
 * Screens never build these objects by hand: they call the helpers in src/app/navigation.ts.
 */

export const SHEETS = [
  'pantries',
  'settings',
  'item-edit',
  'recount',
  'item-move',
  'new-item',
  'stock-view',
  'put-away',
  'notify',
  'install',
  'sync',
] as const;
export type SheetName = (typeof SHEETS)[number];

export const SETTINGS_PAGES = [
  'account',
  'household',
  'member',
  'invite',
  'activity',
  'pantries',
  'pantry',
  'pantry-new',
  'categories',
  'category',
  'category-new',
  'notifications',
  'about',
] as const;
export type SettingsPage = (typeof SETTINGS_PAGES)[number];

export type ScanMode = 'add' | 'withdraw';
export type SheetStep = 'category';

/** Params valid on every route (sheets, confirmations, the scanner cover). */
export interface GlobalSearch {
  sheet?: SheetName;
  /** SettingsSheet push (only with `sheet=settings`). */
  page?: SettingsPage;
  /** Row the sheet or settings page is about (product, member, pantry, category). */
  id?: string;
  /** Secondary step inside ItemEditSheet / NewItemSheet. */
  step?: SheetStep;
  /** Source pantry of RecountSheet. */
  pantry?: string;
  /** ConfirmDialog id (`&confirm=`), over a screen or a sheet. */
  confirm?: string;
  cover?: 'scan';
  /** Scanner mode, read once when the cover opens. Always set when `cover=scan`. */
  mode?: ScanMode;
}

/** Sheets that address a row with `id`. */
const SHEETS_WITH_ID: ReadonlySet<SheetName> = new Set(['item-edit', 'recount', 'item-move']);
const SETTINGS_PAGES_WITH_ID: ReadonlySet<SettingsPage> = new Set(['member', 'pantry', 'category']);
const SHEETS_WITH_STEP: ReadonlySet<SheetName> = new Set(['item-edit', 'new-item']);

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const CONFIRM_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;

type Raw = Record<string, unknown>;

/** A raw query value as a trimmed string; numbers are accepted (other parsers may produce them). */
export function str(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const s = value.trim();
    return s.length > 0 ? s : undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function oneOf<T extends string>(values: readonly T[], value: unknown): T | undefined {
  const s = str(value);
  return s !== undefined && (values as readonly string[]).includes(s) ? (s as T) : undefined;
}

function id(value: unknown): string | undefined {
  const s = str(value);
  return s !== undefined && ID_PATTERN.test(s) ? s : undefined;
}

export function parseGlobalSearch(raw: Raw): GlobalSearch {
  const out: GlobalSearch = {};
  const sheet = oneOf(SHEETS, raw.sheet);
  if (sheet) {
    out.sheet = sheet;
    const rowId = id(raw.id);
    if (sheet === 'settings') {
      const page = oneOf(SETTINGS_PAGES, raw.page);
      if (page) {
        out.page = page;
        if (rowId && SETTINGS_PAGES_WITH_ID.has(page)) out.id = rowId;
      }
    } else if (SHEETS_WITH_ID.has(sheet)) {
      // These sheets are meaningless without their row.
      if (!rowId) {
        delete out.sheet;
      } else {
        out.id = rowId;
      }
    }
    if (out.sheet && SHEETS_WITH_STEP.has(sheet) && str(raw.step) === 'category') out.step = 'category';
    if (out.sheet === 'recount') {
      const pantry = id(raw.pantry);
      if (pantry) out.pantry = pantry;
    }
  }
  const confirm = str(raw.confirm);
  if (confirm && CONFIRM_PATTERN.test(confirm)) out.confirm = confirm;
  if (str(raw.cover) === 'scan') {
    out.cover = 'scan';
    out.mode = oneOf(['add', 'withdraw'] as const, raw.mode) ?? 'add';
  }
  return out;
}

/** Keys owned by the global schema: removed together when an overlay closes. */
export const OVERLAY_KEYS = ['sheet', 'page', 'id', 'step', 'pantry', 'confirm', 'cover', 'mode'] as const;

/** `search` without any overlay param (for remembered tab locations and closing everything). */
export function withoutOverlays<T extends object>(search: T): Omit<T, (typeof OVERLAY_KEYS)[number]> {
  const copy = { ...search } as Record<string, unknown>;
  for (const key of OVERLAY_KEYS) delete copy[key];
  return copy as Omit<T, (typeof OVERLAY_KEYS)[number]>;
}

// ---------------------------------------------------------------------------------------------
// Route-specific params
// ---------------------------------------------------------------------------------------------

export const STOCK_GROUPS = ['category', 'item', 'added', 'price', 'quantity'] as const;
export const STOCK_SORTS = ['name', 'category', 'recent', 'price', 'quantity'] as const;
export type StockGroup = (typeof STOCK_GROUPS)[number];
export type StockSort = (typeof STOCK_SORTS)[number];
export type SortDirection = 'asc' | 'desc';

/** `/stock` (03 §1.5). Defaults are omitted from the URL, so they are absent here too. */
export interface StockSearch {
  q?: string;
  group?: StockGroup;
  sort?: StockSort;
  dir?: SortDirection;
}

export const STOCK_DEFAULTS = { group: 'category', sort: 'name', dir: 'asc' } as const satisfies Required<
  Omit<StockSearch, 'q'>
>;

export function parseStockSearch(raw: Raw): StockSearch {
  const out: StockSearch = {};
  const q = typeof raw.q === 'string' ? raw.q.slice(0, 100) : str(raw.q);
  if (q && q.trim().length > 0) out.q = q;
  const group = oneOf(STOCK_GROUPS, raw.group);
  if (group && group !== STOCK_DEFAULTS.group) out.group = group;
  const sort = oneOf(STOCK_SORTS, raw.sort);
  if (sort && sort !== STOCK_DEFAULTS.sort) out.sort = sort;
  const dir = oneOf(['asc', 'desc'] as const, raw.dir);
  if (dir && dir !== STOCK_DEFAULTS.dir) out.dir = dir;
  return out;
}

/** `/onboarding/join?code=` (prefill). The code is normalised by the page, not here. */
export interface JoinSearch {
  code?: string;
}

export function parseJoinSearch(raw: Raw): JoinSearch {
  const code = str(raw.code);
  return code ? { code: code.slice(0, 16) } : {};
}

/** `/auth/callback` (PKCE fallback). */
export interface AuthCallbackSearch {
  code?: string;
  error?: string;
  error_description?: string;
}

export function parseAuthCallbackSearch(raw: Raw): AuthCallbackSearch {
  const out: AuthCallbackSearch = {};
  const code = str(raw.code);
  if (code) out.code = code;
  const error = str(raw.error);
  if (error) out.error = error;
  const description = str(raw.error_description);
  if (description) out.error_description = description;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Query-string codec (all values are strings; no JSON in the URL)
// ---------------------------------------------------------------------------------------------

export function parseQueryString(searchStr: string): Record<string, string> {
  const params = new URLSearchParams(searchStr.startsWith('?') ? searchStr.slice(1) : searchStr);
  const out: Record<string, string> = {};
  params.forEach((value, key) => {
    if (!(key in out)) out[key] = value;
  });
  return out;
}

export function stringifyQuery(search: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      params.set(key, String(value));
    }
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}
