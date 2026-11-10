import type {
  AnyMutationEnvelope,
  EntityName,
  EntityRowMap,
  HouseholdId,
  MutationArgs,
  MutationErrorCode,
  MutationId,
  MutationName,
} from '@/domain/types';
import type { EntityKey, MutationReducer, ViewDraft } from '../contract';

/** Read-only access to the current view, with iteration for natural-key lookups. */
export interface ViewReader {
  householdId: HouseholdId;
  userId: string;
  get<E extends EntityName>(entity: E, id: string): EntityRowMap[E] | undefined;
  values<E extends EntityName>(entity: E): Iterable<EntityRowMap[E]>;
}

/** The contract's `ViewDraft` plus iteration (the store implements both). */
export interface ReducerDraft extends ViewDraft, ViewReader {}

/** What `touches` may read: the mutation id (movement ids) and the view (stock.revert targets). */
export interface TouchContext extends ViewReader {
  readonly mutationId: MutationId;
}

/**
 * Implementation shape of a reducer. It satisfies the contract's `MutationReducer` (extra parameters
 * are optional there by method bivariance); `touches` also receives the mutation id and the view,
 * because movement rows are keyed by the mutation id and a revert's rows depend on its target.
 */
export interface SyncReducer<N extends MutationName> extends MutationReducer<N> {
  validate(args: MutationArgs[N], view: ReducerDraft): MutationErrorCode | null;
  touches(args: MutationArgs[N], ctx?: TouchContext): EntityKey[];
  apply(draft: ReducerDraft, envelope: Extract<AnyMutationEnvelope, { name: N }>): void;
}

export type SyncReducerTable = { [N in MutationName]: SyncReducer<N> };
