/**
 * Reducers for descriptive entities: household, member, pantry, category, product (02 §3).
 * They mirror supabase/migrations/20261110120700_apply_mutations.sql for the no-concurrency case.
 * Field clocks are server-only; inside the overlay every write comes from this device, so seq order
 * (which is HLC order) is the LWW order and the reducers simply apply fields.
 */
import type {
  Category,
  CategoryFields,
  HouseholdId,
  IsoDateTime,
  MutationErrorCode,
  NetUnit,
  Pantry,
  PantryFields,
  PriceSource,
  Product,
  ProductFields,
} from '@/domain/types';
import type { EntityKey } from '../contract';
import { entityKey, hasOwn, isInt, isText, isUuid, normalizeName } from '../util';
import type { ReducerDraft, SyncReducer, TouchContext } from './types';

const NET_UNITS: readonly NetUnit[] = ['g', 'ml', 'piece'];
const PRICE_SOURCES: readonly PriceSource[] = ['catalog', 'user'];
const GTIN_RE = /^\d{14}$/;

function optionalText(value: unknown, max: number): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.length <= max);
}

// ---------------------------------------------------------------------------------------------
// household.rename, member.updateSelf
// ---------------------------------------------------------------------------------------------

export const householdRename: SyncReducer<'household.rename'> = {
  validate(args, view) {
    if (!isText(args.name, 1, 80)) return 'validation';
    const me = view.get('member', view.userId);
    if (me && me.role !== 'owner') return 'not_owner';
    return null;
  },
  touches(_args, ctx) {
    return ctx ? [entityKey('household', ctx.householdId)] : [];
  },
  apply(draft, env) {
    const row = draft.get('household', draft.householdId);
    if (!row) return;
    draft.put('household', row.id, { ...row, name: env.args.name.trim(), updatedAt: env.clientAt });
  },
};

export const memberUpdateSelf: SyncReducer<'member.updateSelf'> = {
  validate(args) {
    for (const key of Object.keys(args)) {
      if (key !== 'displayName' && key !== 'notifyRunningLow' && key !== 'notifyDigest') return 'validation';
    }
    if (
      args.displayName !== undefined &&
      !(typeof args.displayName === 'string' && args.displayName.trim().length <= 80)
    )
      return 'validation';
    if (args.notifyRunningLow !== undefined && typeof args.notifyRunningLow !== 'boolean') return 'validation';
    if (args.notifyDigest !== undefined && typeof args.notifyDigest !== 'boolean') return 'validation';
    return null;
  },
  touches(_args, ctx) {
    return ctx ? [entityKey('member', ctx.userId)] : [];
  },
  apply(draft, env) {
    const row = draft.get('member', draft.userId);
    if (!row) return;
    const a = env.args;
    draft.put('member', row.userId, {
      ...row,
      displayName: a.displayName !== undefined ? a.displayName.trim() : row.displayName,
      notifyRunningLow: a.notifyRunningLow ?? row.notifyRunningLow,
      notifyDigest: a.notifyDigest ?? row.notifyDigest,
    });
  },
};

// ---------------------------------------------------------------------------------------------
// Pantries and categories: same shape (name natural key, LWW fields, tombstones)
// ---------------------------------------------------------------------------------------------

type NamedEntity = 'pantry' | 'category';
type NamedRow = Pantry | Category;

/** Live or tombstoned row with the same normalised name and a different id. */
function findByName(view: ReducerDraft, entity: NamedEntity, name: string, exceptId?: string): NamedRow | undefined {
  const key = normalizeName(name);
  for (const row of view.values(entity) as Iterable<NamedRow>) {
    if (row.id !== exceptId && normalizeName(row.name) === key) return row;
  }
  return undefined;
}

/** Own key, plus the natural-key match the create would merge into (so recompute covers it). */
function namedCreateTouches(entity: NamedEntity, id: string, name: unknown, ctx?: TouchContext): EntityKey[] {
  const keys = [entityKey(entity, id)];
  if (ctx && !ctx.get(entity, id) && typeof name === 'string') {
    const match = findByName(ctx as unknown as ReducerDraft, entity, name);
    if (match) keys.push(entityKey(entity, match.id));
  }
  return keys;
}

function validateNamedFields(fields: PantryFields | CategoryFields): MutationErrorCode | null {
  for (const key of Object.keys(fields)) {
    if (key !== 'name' && key !== 'icon' && key !== 'color' && key !== 'sortOrder') return 'validation';
  }
  if (hasOwn(fields, 'name') && !isText(fields.name, 1, 60)) return 'validation';
  if (hasOwn(fields, 'icon') && !optionalText(fields.icon, 40)) return 'validation';
  if (hasOwn(fields, 'color') && !optionalText(fields.color, 24)) return 'validation';
  if (hasOwn(fields, 'sortOrder') && !isInt(fields.sortOrder, -2147483648, 2147483647)) return 'validation';
  return null;
}

function applyNamedFields<R extends NamedRow>(row: R, fields: PantryFields | CategoryFields, at: IsoDateTime): R {
  const next = { ...row, updatedAt: at };
  if (fields.name !== undefined) next.name = fields.name.trim();
  if (hasOwn(fields, 'icon')) next.icon = fields.icon ?? null;
  if (hasOwn(fields, 'color')) next.color = fields.color ?? null;
  if (fields.sortOrder !== undefined) next.sortOrder = fields.sortOrder;
  return next;
}

interface NamedCreateArgs {
  name: string;
  icon?: string | null;
  color?: string | null;
  sortOrder?: number;
}

function validateNamedCreate(id: unknown, args: NamedCreateArgs): MutationErrorCode | null {
  if (!isUuid(id)) return 'validation';
  return validateNamedFields({
    name: args.name,
    ...(args.icon !== undefined ? { icon: args.icon } : {}),
    ...(args.color !== undefined ? { color: args.color } : {}),
    ...(args.sortOrder !== undefined ? { sortOrder: args.sortOrder } : {}),
  });
}

/**
 * Create with natural-key merge: the row with this id, else the row with the same normalised name
 * (tombstones included) is kept, revived and its empty icon/colour filled; otherwise insert.
 */
function applyNamedCreate(
  draft: ReducerDraft,
  entity: NamedEntity,
  id: string,
  args: NamedCreateArgs,
  at: IsoDateTime,
  defaultSort: number,
): void {
  const existing = (draft.get(entity, id) as NamedRow | undefined) ?? findByName(draft, entity, args.name);
  if (existing) {
    draft.put(entity, existing.id, {
      ...existing,
      deletedAt: null,
      icon: existing.icon ?? args.icon ?? null,
      color: existing.color ?? args.color ?? null,
      updatedAt: at,
    } as never);
    return;
  }
  const base = {
    id,
    householdId: draft.householdId as HouseholdId,
    name: args.name.trim(),
    icon: args.icon ?? null,
    color: args.color ?? null,
    sortOrder: args.sortOrder ?? defaultSort,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
  };
  if (entity === 'pantry') draft.put('pantry', id, base as Pantry);
  else draft.put('category', id, { ...base, templateKey: null } as Category);
}

function liveRow(view: ReducerDraft, entity: NamedEntity | 'product' | 'grocery', id: string) {
  const row = view.get(entity, id);
  return row && row.deletedAt === null ? row : undefined;
}

function namedUpdateValidate(
  entity: NamedEntity,
  id: string,
  fields: PantryFields | CategoryFields,
  view: ReducerDraft,
) {
  if (!fields || typeof fields !== 'object') return 'validation';
  const err = validateNamedFields(fields);
  if (err) return err;
  if (!liveRow(view, entity, id)) return 'not_found';
  if (fields.name !== undefined && findByName(view, entity, fields.name, id)) return 'name_taken';
  return null;
}

function namedUpdateApply(
  draft: ReducerDraft,
  entity: NamedEntity,
  id: string,
  fields: PantryFields | CategoryFields,
  at: IsoDateTime,
) {
  const row = liveRow(draft, entity, id) as NamedRow | undefined;
  if (!row) return; // server: gone
  if (fields.name !== undefined && findByName(draft, entity, fields.name, id)) return; // server: name_taken
  draft.put(entity, id, applyNamedFields(row, fields, at) as never);
}

function setDeleted(
  draft: ReducerDraft,
  entity: NamedEntity | 'product' | 'grocery',
  id: string,
  deleted: boolean,
  at: IsoDateTime,
) {
  const row = draft.get(entity, id);
  if (!row) return;
  const deletedAt = deleted ? (row.deletedAt ?? at) : null;
  if (deletedAt === row.deletedAt) return;
  draft.put(entity, id, { ...row, deletedAt, updatedAt: at } as never);
}

function existsValidate(view: ReducerDraft, entity: NamedEntity | 'product' | 'grocery', id: string) {
  return view.get(entity, id) ? null : 'not_found';
}

export const pantryCreate: SyncReducer<'pantry.create'> = {
  validate: (args) => validateNamedCreate(args.pantryId, args),
  touches: (args, ctx) => namedCreateTouches('pantry', args.pantryId, args.name, ctx),
  apply: (draft, env) => applyNamedCreate(draft, 'pantry', env.args.pantryId, env.args, env.clientAt, 0),
};
export const pantryUpdate: SyncReducer<'pantry.update'> = {
  validate: (args, view) => namedUpdateValidate('pantry', args.pantryId, args.fields, view),
  touches: (args) => [entityKey('pantry', args.pantryId)],
  apply: (draft, env) => namedUpdateApply(draft, 'pantry', env.args.pantryId, env.args.fields, env.clientAt),
};
export const pantryDelete: SyncReducer<'pantry.delete'> = {
  validate: (args, view) => existsValidate(view, 'pantry', args.pantryId),
  touches: (args) => [entityKey('pantry', args.pantryId)],
  apply: (draft, env) => setDeleted(draft, 'pantry', env.args.pantryId, true, env.clientAt),
};
export const pantryRestore: SyncReducer<'pantry.restore'> = {
  validate: (args, view) => existsValidate(view, 'pantry', args.pantryId),
  touches: (args) => [entityKey('pantry', args.pantryId)],
  apply: (draft, env) => setDeleted(draft, 'pantry', env.args.pantryId, false, env.clientAt),
};

export const categoryCreate: SyncReducer<'category.create'> = {
  validate: (args) => validateNamedCreate(args.categoryId, args),
  touches: (args, ctx) => namedCreateTouches('category', args.categoryId, args.name, ctx),
  apply: (draft, env) => applyNamedCreate(draft, 'category', env.args.categoryId, env.args, env.clientAt, 100),
};
export const categoryUpdate: SyncReducer<'category.update'> = {
  validate: (args, view) => namedUpdateValidate('category', args.categoryId, args.fields, view),
  touches: (args) => [entityKey('category', args.categoryId)],
  apply: (draft, env) => namedUpdateApply(draft, 'category', env.args.categoryId, env.args.fields, env.clientAt),
};
export const categoryDelete: SyncReducer<'category.delete'> = {
  validate: (args, view) => existsValidate(view, 'category', args.categoryId),
  touches: (args) => [entityKey('category', args.categoryId)],
  apply: (draft, env) => setDeleted(draft, 'category', env.args.categoryId, true, env.clientAt),
};
export const categoryRestore: SyncReducer<'category.restore'> = {
  validate: (args, view) => existsValidate(view, 'category', args.categoryId),
  touches: (args) => [entityKey('category', args.categoryId)],
  apply: (draft, env) => setDeleted(draft, 'category', env.args.categoryId, false, env.clientAt),
};

// ---------------------------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------------------------

const PRODUCT_FIELDS = new Set<keyof ProductFields>([
  'name',
  'brand',
  'categoryId',
  'netQuantity',
  'netUnit',
  'packCount',
  'priceCents',
  'priceSource',
  'minQuantity',
  'usualQuantity',
  'lowAlert',
  'imageUrl',
]);

function validateProductFields(fields: ProductFields, requireName: boolean): MutationErrorCode | null {
  const f = fields;
  if (requireName || hasOwn(f, 'name')) if (!isText(f.name, 1, 200)) return 'validation';
  if (hasOwn(f, 'brand') && !optionalText(f.brand, 120)) return 'validation';
  if (hasOwn(f, 'categoryId') && f.categoryId !== null && !isUuid(f.categoryId)) return 'validation';
  if (hasOwn(f, 'netQuantity') && f.netQuantity !== null && !(typeof f.netQuantity === 'number' && f.netQuantity > 0))
    return 'validation';
  if (hasOwn(f, 'netUnit') && f.netUnit !== null && !NET_UNITS.includes(f.netUnit as NetUnit)) return 'validation';
  if (hasOwn(f, 'packCount') && f.packCount !== null && !isInt(f.packCount, 1, 999)) return 'validation';
  if (hasOwn(f, 'priceCents') && f.priceCents !== null && !isInt(f.priceCents, 0, 10_000_000)) return 'validation';
  if (hasOwn(f, 'priceSource') && f.priceSource !== null && !PRICE_SOURCES.includes(f.priceSource as PriceSource))
    return 'validation';
  if (hasOwn(f, 'minQuantity') && f.minQuantity !== null && !isInt(f.minQuantity, 0, 9999)) return 'validation';
  if (hasOwn(f, 'usualQuantity') && f.usualQuantity !== null && !isInt(f.usualQuantity, 1, 9999)) return 'validation';
  if (hasOwn(f, 'lowAlert') && f.lowAlert !== null && typeof f.lowAlert !== 'boolean') return 'validation';
  if (hasOwn(f, 'imageUrl') && !optionalText(f.imageUrl, 500)) return 'validation';
  return null;
}

/** Natural key of a product: GTIN when present, else normalised name among products without GTIN. */
export function findProductByNaturalKey(
  view: { values(entity: 'product'): Iterable<Product> },
  gtin: string | null | undefined,
  name: string,
  exceptId?: string,
): Product | undefined {
  const key = normalizeName(name);
  for (const p of view.values('product')) {
    if (p.id === exceptId) continue;
    if (gtin ? p.gtin === gtin : p.gtin === null && normalizeName(p.name) === key) return p;
  }
  return undefined;
}

export const productCreate: SyncReducer<'product.create'> = {
  validate(args) {
    if (!isUuid(args.productId)) return 'validation';
    for (const key of Object.keys(args)) {
      if (key !== 'productId' && key !== 'gtin' && key !== 'catalogGtin' && !PRODUCT_FIELDS.has(key as never))
        return 'validation';
    }
    if (args.gtin != null && !GTIN_RE.test(args.gtin)) return 'validation';
    if (args.catalogGtin != null && !GTIN_RE.test(args.catalogGtin)) return 'validation';
    return validateProductFields(args, true);
  },
  touches(args, ctx) {
    const keys = [entityKey('product', args.productId)];
    if (ctx && !ctx.get('product', args.productId) && typeof args.name === 'string') {
      const match = findProductByNaturalKey(ctx, args.gtin ?? null, args.name);
      if (match) keys.push(entityKey('product', match.id));
    }
    return keys;
  },
  apply(draft, env) {
    const a = env.args;
    const at = env.clientAt;
    const existing = draft.get('product', a.productId) ?? findProductByNaturalKey(draft, a.gtin ?? null, a.name);
    if (existing) {
      draft.put('product', existing.id, {
        ...existing,
        deletedAt: null,
        brand: existing.brand ?? a.brand ?? null,
        catalogGtin: existing.catalogGtin ?? a.catalogGtin ?? null,
        categoryId: existing.categoryId ?? a.categoryId ?? null,
        netQuantity: existing.netQuantity ?? a.netQuantity ?? null,
        netUnit: existing.netUnit ?? a.netUnit ?? null,
        packCount: existing.packCount ?? a.packCount ?? null,
        priceCents: existing.priceCents ?? a.priceCents ?? null,
        priceSource: existing.priceSource ?? a.priceSource ?? null,
        minQuantity: existing.minQuantity ?? a.minQuantity ?? null,
        usualQuantity: existing.usualQuantity ?? a.usualQuantity ?? null,
        imageUrl: existing.imageUrl ?? a.imageUrl ?? null,
        updatedAt: at,
      });
      return;
    }
    draft.put('product', a.productId, {
      id: a.productId,
      householdId: draft.householdId,
      name: a.name.trim(),
      brand: a.brand ?? null,
      gtin: a.gtin || null,
      catalogGtin: a.catalogGtin || null,
      categoryId: a.categoryId ?? null,
      netQuantity: a.netQuantity ?? null,
      netUnit: a.netUnit ?? null,
      packCount: a.packCount ?? null,
      priceCents: a.priceCents ?? null,
      priceSource: a.priceSource ?? null,
      minQuantity: a.minQuantity ?? null,
      usualQuantity: a.usualQuantity ?? null,
      lowAlert: a.lowAlert ?? true,
      imageUrl: a.imageUrl ?? null,
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
    });
  },
};

function productNameTaken(view: ReducerDraft, row: Product, name: string): boolean {
  return row.gtin === null && findProductByNaturalKey(view, null, name, row.id) !== undefined;
}

export const productUpdate: SyncReducer<'product.update'> = {
  validate(args, view) {
    if (!args.fields || typeof args.fields !== 'object') return 'validation';
    for (const key of Object.keys(args.fields)) if (!PRODUCT_FIELDS.has(key as never)) return 'validation';
    const err = validateProductFields(args.fields, false);
    if (err) return err;
    const row = liveRow(view, 'product', args.productId) as Product | undefined;
    if (!row) return 'not_found';
    if (args.fields.name !== undefined && productNameTaken(view, row, args.fields.name)) return 'name_taken';
    return null;
  },
  touches: (args) => [entityKey('product', args.productId)],
  apply(draft, env) {
    const row = liveRow(draft, 'product', env.args.productId) as Product | undefined;
    if (!row) return;
    const f = env.args.fields;
    if (f.name !== undefined && productNameTaken(draft, row, f.name)) return;
    const next: Product = { ...row, updatedAt: env.clientAt };
    if (f.name !== undefined) next.name = f.name.trim();
    if (hasOwn(f, 'brand')) next.brand = f.brand ?? null;
    if (hasOwn(f, 'categoryId')) next.categoryId = f.categoryId ?? null;
    if (hasOwn(f, 'netQuantity')) next.netQuantity = f.netQuantity ?? null;
    if (hasOwn(f, 'netUnit')) next.netUnit = f.netUnit ?? null;
    if (hasOwn(f, 'packCount')) next.packCount = f.packCount ?? null;
    if (hasOwn(f, 'priceCents')) next.priceCents = f.priceCents ?? null;
    if (hasOwn(f, 'priceSource')) next.priceSource = f.priceSource ?? null;
    if (hasOwn(f, 'minQuantity')) next.minQuantity = f.minQuantity ?? null;
    if (hasOwn(f, 'usualQuantity')) next.usualQuantity = f.usualQuantity ?? null;
    if (hasOwn(f, 'lowAlert')) next.lowAlert = f.lowAlert ?? true;
    if (hasOwn(f, 'imageUrl')) next.imageUrl = f.imageUrl ?? null;
    draft.put('product', row.id, next);
  },
};

export const productDelete: SyncReducer<'product.delete'> = {
  validate: (args, view) => existsValidate(view, 'product', args.productId),
  touches: (args) => [entityKey('product', args.productId)],
  apply: (draft, env) => setDeleted(draft, 'product', env.args.productId, true, env.clientAt),
};
export const productRestore: SyncReducer<'product.restore'> = {
  validate: (args, view) => existsValidate(view, 'product', args.productId),
  touches: (args) => [entityKey('product', args.productId)],
  apply: (draft, env) => setDeleted(draft, 'product', env.args.productId, false, env.clientAt),
};

export { existsValidate, liveRow, setDeleted };
