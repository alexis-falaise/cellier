import type { AnyMutationEnvelope, MutationErrorCode, MutationName } from '@/domain/types';
import type { EntityKey, ReducerTable } from '../contract';
import {
  categoryCreate,
  categoryDelete,
  categoryRestore,
  categoryUpdate,
  householdRename,
  memberUpdateSelf,
  pantryCreate,
  pantryDelete,
  pantryRestore,
  pantryUpdate,
  productCreate,
  productDelete,
  productRestore,
  productUpdate,
} from './descriptive';
import { groceryAdd, groceryDelete, groceryRestore, groceryUpdate } from './grocery';
import { stockAdd, stockRecount, stockRemove, stockRevert, stockTransfer } from './stock';
import type { ReducerDraft, SyncReducer, SyncReducerTable, TouchContext } from './types';

export const reducers: SyncReducerTable = {
  'household.rename': householdRename,
  'member.updateSelf': memberUpdateSelf,
  'pantry.create': pantryCreate,
  'pantry.update': pantryUpdate,
  'pantry.delete': pantryDelete,
  'pantry.restore': pantryRestore,
  'category.create': categoryCreate,
  'category.update': categoryUpdate,
  'category.delete': categoryDelete,
  'category.restore': categoryRestore,
  'product.create': productCreate,
  'product.update': productUpdate,
  'product.delete': productDelete,
  'product.restore': productRestore,
  'stock.add': stockAdd,
  'stock.remove': stockRemove,
  'stock.recount': stockRecount,
  'stock.transfer': stockTransfer,
  'stock.revert': stockRevert,
  'grocery.add': groceryAdd,
  'grocery.update': groceryUpdate,
  'grocery.delete': groceryDelete,
  'grocery.restore': groceryRestore,
};

/** The table typed as the contract's `ReducerTable`. */
export const reducerTable: ReducerTable = reducers;

export const MUTATION_NAMES = Object.keys(reducers) as MutationName[];

function reducerFor(name: MutationName): SyncReducer<MutationName> {
  return reducers[name] as unknown as SyncReducer<MutationName>;
}

/** Dispatchers over the union (avoid a cast at every call site). */
export function applyEnvelope(draft: ReducerDraft, envelope: AnyMutationEnvelope): void {
  reducerFor(envelope.name).apply(draft, envelope as never);
}
export function touchesOf(envelope: AnyMutationEnvelope, ctx: TouchContext): EntityKey[] {
  return reducerFor(envelope.name).touches(envelope.args as never, ctx);
}
export function validateMutation(name: MutationName, args: unknown, view: ReducerDraft): MutationErrorCode | null {
  const r = reducers[name] as SyncReducer<MutationName> | undefined;
  if (!r) return 'unknown_mutation';
  if (!args || typeof args !== 'object') return 'validation';
  return r.validate(args as never, view);
}

export { findProductByNaturalKey } from './descriptive';
export { openGroceryEntryFor } from './grocery';
export { PENDING_SEQ, pendingInLegId, pendingSecondCorrectionId, transferLegs } from './stock';
export type { ReducerDraft, SyncReducer, SyncReducerTable, TouchContext, ViewReader } from './types';
