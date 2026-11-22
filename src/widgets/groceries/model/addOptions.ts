/**
 * «Ajouter un article» choices (design 03 §4.8.2): one per line of the list, so the household's four
 * ground coffees are offered once, as «Café moulu». Pure.
 */
import type { Category, ProductId } from '@/domain/types';
import { fold } from '@/shared/i18n';
import { type HouseholdForecasts, lineMembers, lineOf } from './householdForecasts';

export interface GroceryAddOption {
  /** Product the row is created for: the kind's representative, else the product itself. */
  productId: ProductId;
  /** List name: the kind («Café moulu»), else the product name. */
  name: string;
  category: Category | null;
  /** Every product of the line; the option is not offered while one of them is on the list. */
  members: readonly string[];
  /** Folded texts the query is matched against: the list name, then each product's own name. */
  terms: readonly string[];
}

export function groceryAddOptions(
  h: Pick<HouseholdForecasts, 'views' | 'viewsById' | 'kinds' | 'names'>,
): GroceryAddOption[] {
  const out: GroceryAddOption[] = [];
  const seen = new Set<string>();
  for (const v of h.views) {
    const line = lineOf(h, v.product.id);
    if (seen.has(line)) continue;
    seen.add(line);
    const head = h.viewsById.get(line) ?? v;
    const name = h.names.get(head.product.id) ?? head.product.name;
    const members = lineMembers(h, line);
    const own = members.map((id) => h.viewsById.get(id)?.product.name ?? '').filter(Boolean);
    out.push({
      productId: head.product.id,
      name,
      category: head.category,
      members,
      terms: [...new Set([name, ...own].map(fold))],
    });
  }
  return out;
}

const MAX_MATCHES = 5;

/**
 * Up to five lines matching the query, not already on the list: list names starting with it first,
 * then any list or product name containing it («colombie» finds «Café moulu»).
 */
export function matchAddOptions(
  options: readonly GroceryAddOption[],
  query: string,
  listed: ReadonlySet<string>,
): GroceryAddOption[] {
  const q = fold(query.trim());
  if (!q) return [];
  const prefix: GroceryAddOption[] = [];
  const inner: GroceryAddOption[] = [];
  for (const o of options) {
    if (o.members.some((id) => listed.has(id))) continue;
    if (o.terms[0]?.startsWith(q)) prefix.push(o);
    else if (o.terms.some((term) => term.includes(q))) inner.push(o);
    if (prefix.length >= MAX_MATCHES) break;
  }
  return [...prefix, ...inner].slice(0, MAX_MATCHES);
}
