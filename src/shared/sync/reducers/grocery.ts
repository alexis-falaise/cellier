/** Courses reducers (02 §3 grocery.*). Checking an entry never changes stock. */
import type { GroceryEntry, UserId } from '@/domain/types';
import { entityKey, hasOwn, isInt, isText, isUuid } from '../util';
import { existsValidate, liveRow, setDeleted } from './descriptive';
import type { SyncReducer, ViewReader } from './types';

/** The open entry (unchecked, not dismissed, not deleted) of a product, if any. */
export function openGroceryEntryFor(view: ViewReader, productId: string, exceptId?: string): GroceryEntry | undefined {
  for (const g of view.values('grocery')) {
    if (g.id === exceptId) continue;
    if (g.productId === productId && g.checkedAt === null && g.dismissedAt === null && g.deletedAt === null) return g;
  }
  return undefined;
}

export const groceryAdd: SyncReducer<'grocery.add'> = {
  validate(args, view) {
    if (!isUuid(args.groceryId)) return 'validation';
    const hasProduct = args.productId != null;
    const hasLabel = args.label != null && args.label.trim() !== '';
    if (hasProduct === hasLabel) return 'validation';
    if (hasLabel && !isText(args.label, 1, 80)) return 'validation';
    if (args.quantity != null && !isInt(args.quantity, 1, 999)) return 'validation';
    if (hasProduct && !liveRow(view, 'product', args.productId as string)) return 'not_found';
    return null;
  },
  touches(args, ctx) {
    const keys = [entityKey('grocery', args.groceryId)];
    if (args.productId != null) keys.push(entityKey('product', args.productId));
    if (ctx && args.productId != null && !ctx.get('grocery', args.groceryId)) {
      const open = openGroceryEntryFor(ctx, args.productId);
      if (open) keys.push(entityKey('grocery', open.id));
    }
    return keys;
  },
  apply(draft, env) {
    const a = env.args;
    const at = env.clientAt;
    if (a.productId != null && !liveRow(draft, 'product', a.productId)) return; // server: gone
    const existing =
      draft.get('grocery', a.groceryId) ?? (a.productId != null ? openGroceryEntryFor(draft, a.productId) : undefined);
    if (existing) {
      if (existing.quantity === null && a.quantity != null) {
        draft.put('grocery', existing.id, { ...existing, quantity: a.quantity, updatedAt: at });
      }
      return;
    }
    draft.put('grocery', a.groceryId, {
      id: a.groceryId,
      householdId: draft.householdId,
      productId: a.productId ?? null,
      label: a.productId != null ? null : (a.label?.trim() ?? null),
      quantity: a.quantity ?? null,
      addedBy: draft.userId as UserId,
      checkedAt: null,
      checkedBy: null,
      dismissedAt: null,
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
    });
  },
};

export const groceryUpdate: SyncReducer<'grocery.update'> = {
  validate(args, view) {
    const f = args.fields;
    if (!f || typeof f !== 'object') return 'validation';
    for (const key of Object.keys(f)) {
      if (key !== 'label' && key !== 'quantity' && key !== 'checked' && key !== 'dismissed') return 'validation';
    }
    if (hasOwn(f, 'label') && !isText(f.label, 1, 80)) return 'validation';
    if (hasOwn(f, 'quantity') && f.quantity !== null && !isInt(f.quantity, 1, 999)) return 'validation';
    if (hasOwn(f, 'checked') && typeof f.checked !== 'boolean') return 'validation';
    if (hasOwn(f, 'dismissed') && typeof f.dismissed !== 'boolean') return 'validation';
    const row = liveRow(view, 'grocery', args.groceryId) as GroceryEntry | undefined;
    if (!row) return 'not_found';
    if (hasOwn(f, 'label') && row.productId !== null) return 'validation';
    // Re-opening an entry while another open entry exists for the product would break the natural key.
    const reopening =
      (f.checked === false && row.checkedAt !== null) || (f.dismissed === false && row.dismissedAt !== null);
    if (reopening && row.productId !== null && openGroceryEntryFor(view, row.productId, row.id)) return 'validation';
    return null;
  },
  touches: (args) => [entityKey('grocery', args.groceryId)],
  apply(draft, env) {
    const row = liveRow(draft, 'grocery', env.args.groceryId) as GroceryEntry | undefined;
    if (!row) return;
    const f = env.args.fields;
    if (hasOwn(f, 'label') && row.productId !== null) return; // server: invalid
    const next: GroceryEntry = { ...row, updatedAt: env.clientAt };
    if (f.label !== undefined) next.label = f.label.trim() || null;
    if (hasOwn(f, 'quantity')) next.quantity = f.quantity ?? null;
    if (f.checked !== undefined) {
      next.checkedAt = f.checked ? (row.checkedAt ?? env.clientAt) : null;
      next.checkedBy = f.checked ? (row.checkedBy ?? (draft.userId as UserId)) : null;
    }
    if (f.dismissed !== undefined) next.dismissedAt = f.dismissed ? (row.dismissedAt ?? env.clientAt) : null;
    draft.put('grocery', row.id, next);
  },
};

export const groceryDelete: SyncReducer<'grocery.delete'> = {
  validate: (args, view) => existsValidate(view, 'grocery', args.groceryId),
  touches: (args) => [entityKey('grocery', args.groceryId)],
  apply: (draft, env) => setDeleted(draft, 'grocery', env.args.groceryId, true, env.clientAt),
};
export const groceryRestore: SyncReducer<'grocery.restore'> = {
  validate: (args, view) => existsValidate(view, 'grocery', args.groceryId),
  touches: (args) => [entityKey('grocery', args.groceryId)],
  apply: (draft, env) => setDeleted(draft, 'grocery', env.args.groceryId, false, env.clientAt),
};
