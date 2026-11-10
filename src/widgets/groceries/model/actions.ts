/**
 * Courses writes (design 03 §4.8). Every write is a mutation (optimistic, offline-safe). A pure
 * suggestion has no row: the first action on it creates one (`grocery.add`), then updates it.
 * Checking an entry never changes stock; only «Ranger» records purchases.
 */
import { showToast } from '@/app/toasts';
import type { GroceryId, PantryId, ProductId } from '@/domain/types';
import type { GroceryItem } from '@/features/forecast';
import { t } from '@/shared/i18n';
import { MutationValidationError, mutate, syncActions } from '@/shared/sync';

const newId = () => crypto.randomUUID() as GroceryId;

function report(error: unknown): void {
  if (error instanceof MutationValidationError) {
    console.warn('[courses] write refused', error);
    return;
  }
  throw error;
}

/** Row id of an item, creating the row for a pure suggestion. */
function ensureRow(item: GroceryItem, quantity: number | null = null): GroceryId {
  if (item.entryId) return item.entryId;
  if (item.kind !== 'product') throw new Error('A label item always has a row.');
  return mutate('grocery.add', { groceryId: newId(), productId: item.productId, quantity }) as unknown as GroceryId;
}

export function setChecked(item: GroceryItem, checked: boolean): void {
  try {
    const groceryId = ensureRow(item);
    mutate('grocery.update', { groceryId, fields: { checked } });
  } catch (error) {
    // Unchecking a product that already has another open row: the checked row is redundant.
    if (!checked && item.entryId && error instanceof MutationValidationError) {
      mutate('grocery.delete', { groceryId: item.entryId });
      return;
    }
    report(error);
  }
}

export function setQuantity(item: GroceryItem, quantity: number): void {
  if (quantity === item.quantity && item.entryId) return;
  try {
    if (!item.entryId) {
      ensureRow(item, quantity);
      return;
    }
    mutate('grocery.update', { groceryId: item.entryId, fields: { quantity } });
  } catch (error) {
    report(error);
  }
}

/**
 * «Masquer» (trailing swipe): a suggestion is dismissed until the next purchase of the product;
 * a manual row is removed. Both with «Annuler» in the toast.
 */
export function hide(item: GroceryItem): void {
  try {
    if (item.kind === 'label' || item.reason === 'manual') {
      const groceryId = item.entryId as GroceryId;
      const mutationId = mutate('grocery.delete', { groceryId });
      showToast({
        message: t('toast.groceryRemoved'),
        action: { label: t('common.undo'), onPress: () => void syncActions.undo(mutationId).catch(report) },
      });
      return;
    }
    const existed = item.entryId !== null;
    const groceryId = ensureRow(item);
    mutate('grocery.update', { groceryId, fields: { dismissed: true } });
    const undo = existed
      ? () => {
          try {
            mutate('grocery.update', { groceryId, fields: { dismissed: false } });
          } catch (error) {
            report(error);
          }
        }
      : () => void syncActions.undo(groceryId as never).catch(report);
    showToast({ message: t('toast.dismissed'), action: { label: t('common.undo'), onPress: undo } });
  } catch (error) {
    report(error);
  }
}

/** Adds a household product to the list (quantity: the suggested one) or a free-text row. */
export function addProduct(productId: ProductId): void {
  try {
    mutate('grocery.add', { groceryId: newId(), productId, quantity: null });
  } catch (error) {
    report(error);
  }
}

export function addLabel(label: string): void {
  const text = label.trim().slice(0, 80);
  if (!text) return;
  try {
    mutate('grocery.add', { groceryId: newId(), label: text, quantity: null });
  } catch (error) {
    report(error);
  }
}

/** Units the put-away records (free-text rows count as one). */
export function putAwayCount(items: readonly GroceryItem[]): number {
  return items.reduce((sum, i) => sum + (i.kind === 'product' ? i.quantity : 1), 0);
}

/**
 * «Ranger dans {pantry}» (§4.8.4): one purchase per checked product at its quantity, then the
 * checked rows leave the list (free-text rows are not stock-tracked). One toast undoes it all.
 */
export function putAway(items: readonly GroceryItem[], pantryId: PantryId, pantryName: string): void {
  const done: ReturnType<typeof mutate>[] = [];
  try {
    for (const item of items) {
      if (item.kind === 'product') {
        done.push(
          mutate('stock.add', {
            pantryId,
            productId: item.productId,
            quantity: Math.max(1, item.quantity),
            source: 'put_away',
          }),
        );
      }
      if (item.entryId) done.push(mutate('grocery.delete', { groceryId: item.entryId }));
    }
  } catch (error) {
    report(error);
  }
  if (done.length === 0) return;
  showToast({
    message: t('toast.putAway', { n: putAwayCount(items), pantry: pantryName }),
    action: {
      label: t('common.undo'),
      onPress: () => {
        void (async () => {
          for (const id of [...done].reverse()) await syncActions.undo(id).catch(report);
        })();
      },
    },
  });
}
