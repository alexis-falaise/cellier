/**
 * Kinds and categories (05-catalogue.md §5.8). Pure helpers around the `classify-product` answer.
 *
 * Precedence for a product's category:
 *   1. a member's override: a product of the same kind whose category a member chose
 *      (`categorySource 'user'`), the most recently updated one;
 *   2. the product's own member choice or a real catalogue category ('catalog', not 'autre');
 *   3. the classifier's category.
 * A kind set by a member (`kindSource 'user'`) is never replaced; the members' kinds are sent to
 * the model as examples so similar products get the same kind.
 */
import type { Category, CategoryId, CategoryKey, Product, ProductFields } from '@/domain/types';
import { resolveHouseholdCategory } from '@/features/catalogue';
import { normalizeName } from '@/shared/sync/util';

export interface ClassifyRequestItem {
  id: string;
  name: string;
  brand: string | null;
  categoryKey: CategoryKey | null;
}

export interface ClassifyExample {
  name: string;
  kind: string;
  categoryKey: CategoryKey | null;
}

export interface ClassifyAnswer {
  id: string;
  kind: string;
  categoryKey: CategoryKey;
  suggestedMin: number;
}

type CategoryRef = Pick<Category, 'id' | 'templateKey' | 'deletedAt'>;

export const CLASSIFY_BATCH = 25;
const MAX_EXAMPLES = 40;

export const kindKey = (kind: string | null): string | null => (kind ? normalizeName(kind) : null);

function liveCategory(categories: readonly CategoryRef[], id: CategoryId | null): CategoryRef | null {
  return categories.find((c) => c.id === id && c.deletedAt === null) ?? null;
}

/** Products waiting for the classifier: live, no kind yet, not tried in this session. */
export function pendingClassification(products: readonly Product[], tried: ReadonlySet<string>): Product[] {
  return products.filter((p) => p.deletedAt === null && p.kind === null && !tried.has(p.id));
}

/** Distinct kinds of the household, as written. */
export function householdKinds(products: readonly Product[]): string[] {
  const byKey = new Map<string, string>();
  for (const p of products) {
    const key = kindKey(p.kind);
    if (p.deletedAt === null && key && p.kind && !byKey.has(key)) byKey.set(key, p.kind);
  }
  return [...byKey.values()];
}

/** Members' corrections (their own kind or category), most recently updated first. */
export function householdExamples(products: readonly Product[], categories: readonly CategoryRef[]): ClassifyExample[] {
  return products
    .filter((p) => p.deletedAt === null && p.kind && (p.kindSource === 'user' || p.categorySource === 'user'))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, MAX_EXAMPLES)
    .map((p) => ({
      name: p.name,
      kind: p.kind as string,
      categoryKey: p.categorySource === 'user' ? (liveCategory(categories, p.categoryId)?.templateKey ?? null) : null,
    }));
}

/** The category a member chose for this kind, if any (most recently updated product wins). */
export function kindOverrideCategory(
  kind: string | null,
  products: readonly Product[],
  categories: readonly CategoryRef[],
  exceptId?: string,
): CategoryId | null {
  const key = kindKey(kind);
  if (!key) return null;
  let best: Product | null = null;
  for (const p of products) {
    if (p.id === exceptId || p.deletedAt !== null || p.categorySource !== 'user') continue;
    if (kindKey(p.kind) !== key || !liveCategory(categories, p.categoryId)) continue;
    if (!best || p.updatedAt > best.updatedAt) best = p;
  }
  return best?.categoryId ?? null;
}

/** Catalogue category hint sent to the model: the product's category when the rules placed it. */
export function requestItem(product: Product, categories: readonly CategoryRef[]): ClassifyRequestItem {
  const key =
    product.categorySource === 'catalog' ? (liveCategory(categories, product.categoryId)?.templateKey ?? null) : null;
  return { id: product.id, name: product.name, brand: product.brand, categoryKey: key === 'autre' ? null : key };
}

/** True when the product's category must not be replaced by the model. */
function categoryIsSettled(product: Product, categories: readonly CategoryRef[]): boolean {
  if (product.categorySource === 'user') return true;
  if (product.categorySource !== 'catalog') return false;
  const key = liveCategory(categories, product.categoryId)?.templateKey ?? null;
  return product.categoryId !== null && key !== 'autre';
}

/** The `product.update` fields for one classifier answer; empty when nothing changes. */
export function fieldsFromAnswer(
  product: Product,
  answer: ClassifyAnswer,
  products: readonly Product[],
  categories: readonly CategoryRef[],
): ProductFields {
  const fields: ProductFields = {};
  const kind = product.kindSource === 'user' && product.kind ? product.kind : answer.kind;
  if (product.kind === null) {
    fields.kind = kind;
    fields.kindSource = 'model';
  }
  if (product.suggestedMin !== answer.suggestedMin) fields.suggestedMin = answer.suggestedMin;

  const override = kindOverrideCategory(kind, products, categories, product.id);
  if (override !== null && product.categorySource !== 'user') {
    if (override !== product.categoryId) fields.categoryId = override;
    fields.categorySource = 'model';
  } else if (!categoryIsSettled(product, categories)) {
    const chosen = resolveHouseholdCategory(categories, answer.categoryKey);
    if (chosen !== product.categoryId) fields.categoryId = chosen;
    if (product.categorySource !== 'model') fields.categorySource = 'model';
  }
  return fields;
}

/**
 * A member changed a product's category: the other products of its kind follow, except those a
 * member placed themselves. Returns one update per product to move.
 */
export function propagateCategory(
  product: Pick<Product, 'id' | 'kind'>,
  categoryId: CategoryId | null,
  products: readonly Product[],
): Array<{ productId: Product['id']; fields: ProductFields }> {
  const key = kindKey(product.kind);
  if (!key) return [];
  return products
    .filter(
      (p) =>
        p.id !== product.id &&
        p.deletedAt === null &&
        kindKey(p.kind) === key &&
        p.categorySource !== 'user' &&
        p.categoryId !== categoryId,
    )
    .map((p) => ({ productId: p.id, fields: { categoryId, categorySource: 'model' } }));
}

/** Category source for a newly created product, from where its category came. */
export function createdCategorySource(
  categoryId: CategoryId | null,
  categories: readonly CategoryRef[],
  chosenByMember: boolean,
): Product['categorySource'] {
  if (categoryId === null) return null;
  if (chosenByMember) return 'user';
  const key = liveCategory(categories, categoryId)?.templateKey ?? null;
  return key === 'autre' ? null : 'catalog';
}
