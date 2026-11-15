import type { Category } from '@/domain/types';
import { fr, getLocale, type MessageKey, t } from '@/shared/i18n';

const localized = new WeakMap<Category, Category>();

/**
 * The server seeds the default categories with their French names, and the household shares them.
 * As long as nobody has renamed one, each member reads it in their own language; a renamed category
 * keeps the name it was given. The same row always gives the same object, so selectors stay stable.
 */
export function localizeCategory(category: Category): Category {
  if (getLocale() === 'fr' || category.templateKey === null) return category;
  const key = `category.default.${category.templateKey}` as Extract<MessageKey, `category.default.${string}`>;
  if (category.name !== fr[key]) return category;
  let copy = localized.get(category);
  if (!copy) {
    copy = { ...category, name: t(key) };
    localized.set(category, copy);
  }
  return copy;
}
