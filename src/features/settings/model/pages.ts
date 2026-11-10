/**
 * Page model of the Réglages sheet (design 03 §1.2, §4.10–4.15): `?sheet=settings&page=…&id=…`
 * becomes a stack of pages, root first, so a deep link shows the pages a user would have pushed.
 */
import type { SettingsPage } from '@/app/navigation';
import type { MessageKey, MessageParams } from '@/shared/i18n';

export type SettingsPageName = SettingsPage | 'root';

/** Catalogue keys without placeholders: `t(key)` needs no parameters. */
export type PlainMessageKey = { [K in MessageKey]: keyof MessageParams<K> extends never ? K : never }[MessageKey];

export interface SettingsRoute {
  page: SettingsPageName;
  id?: string | undefined;
}

export interface SettingsStackEntry extends SettingsRoute {
  /** Stable key of the layer in the stack. */
  key: string;
}

const PARENT: Partial<Record<SettingsPage, SettingsPage>> = {
  member: 'household',
  invite: 'household',
  activity: 'household',
  pantry: 'pantries',
  'pantry-new': 'pantries',
  category: 'categories',
  'category-new': 'categories',
};

const NEEDS_ID: ReadonlySet<SettingsPage> = new Set(['member', 'pantry', 'category']);

/** Title of each page, used by the back button of the page pushed over it. */
export const PAGE_TITLE: Record<SettingsPageName, PlainMessageKey> = {
  root: 'settings.title',
  account: 'settings.title',
  household: 'household.title',
  member: 'household.members',
  invite: 'household.invite',
  activity: 'household.activity',
  pantries: 'pantries.title',
  pantry: 'pantries.title',
  'pantry-new': 'pantries.new',
  categories: 'categories.title',
  category: 'categories.title',
  'category-new': 'categories.new',
  notifications: 'notifications.title',
  about: 'about.sources',
};

/** The pages under and including the current one. A page that needs an id and has none shows its parent. */
export function settingsStack(page: SettingsPage | undefined, id?: string | undefined): SettingsStackEntry[] {
  const stack: SettingsStackEntry[] = [{ key: 'root', page: 'root' }];
  if (!page) return stack;
  let top: SettingsPage | undefined = page;
  if (NEEDS_ID.has(page) && !id) top = PARENT[page];
  const chain: SettingsPage[] = [];
  for (let p = top; p; p = PARENT[p]) chain.unshift(p);
  for (const p of chain) {
    const entryId = p === top && NEEDS_ID.has(p) ? id : undefined;
    stack.push({ key: entryId ? `${p}:${entryId}` : p, page: p, ...(entryId ? { id: entryId } : {}) });
  }
  return stack;
}

/** Page whose title the back button of `page` shows. */
export function parentPage(page: SettingsPageName): SettingsPageName {
  if (page === 'root') return 'root';
  return PARENT[page] ?? 'root';
}
