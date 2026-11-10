/**
 * Stock writes shared by the Stock list and item detail. Everything goes through `mutate`
 * (optimistic, queued, offline-safe). Withdrawals are clamped at the shelf in the UI too.
 */
import { useEffect, useRef, useState } from 'react';
import type { MovementSource, MutationArgs, MutationId, MutationName, PantryId, ProductId } from '@/domain/types';
import { mutate } from '@/shared/sync';

/** `mutate` that reports a refused call (validation, sync not started) instead of throwing into React. */
export function tryMutate<N extends MutationName>(name: N, args: MutationArgs[N]): MutationId | null {
  try {
    return mutate(name, args);
  } catch (error) {
    console.error(`[stock] ${name} refused`, error);
    return null;
  }
}

const MAX_STEP = 9999;

/** +n (purchase) or −n (consume) on one cellier; −n is clamped to what is on the shelf. */
export function changeStock(
  pantryId: string,
  productId: string,
  delta: number,
  current: number,
  source: MovementSource,
): MutationId | null {
  const ids = { pantryId: pantryId as PantryId, productId: productId as ProductId };
  if (delta > 0) return tryMutate('stock.add', { ...ids, quantity: Math.min(MAX_STEP, Math.round(delta)), source });
  const quantity = Math.min(MAX_STEP, Math.round(-delta), Math.max(0, current));
  if (quantity <= 0) return null;
  return tryMutate('stock.remove', { ...ids, quantity, reason: 'consume', source });
}

/** Physical count (absolute, not demand). */
export function recountStock(
  pantryId: string,
  productId: string,
  counted: number,
  source: MovementSource,
): MutationId | null {
  const value = Math.max(0, Math.min(99_999, Math.round(counted)));
  return tryMutate('stock.recount', {
    pantryId: pantryId as PantryId,
    productId: productId as ProductId,
    counted: value,
    source,
  });
}

const FLUSH_MS = 600;

/**
 * Stepper over one stock row: taps and hold-to-repeat accumulate into one movement written after
 * a short pause (one history entry for «+5», not five), a typed value is a recount. The shown
 * value is the store value plus the not yet written steps, never below 0.
 */
export function useStockStepper(pantryId: string | null, productId: string, storeQuantity: number) {
  const [pending, setPending] = useState(0);
  const state = useRef({ pending: 0, timer: undefined as ReturnType<typeof setTimeout> | undefined });
  const latest = useRef({ pantryId, productId, storeQuantity });
  useEffect(() => {
    latest.current = { pantryId, productId, storeQuantity };
  });

  const flush = () => {
    const s = state.current;
    clearTimeout(s.timer);
    s.timer = undefined;
    const delta = s.pending;
    s.pending = 0;
    setPending(0);
    const l = latest.current;
    if (delta !== 0 && l.pantryId) changeStock(l.pantryId, l.productId, delta, l.storeQuantity, 'stepper');
  };
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  });
  useEffect(() => () => flushRef.current(), []);

  const value = Math.max(0, storeQuantity + pending);

  const setValue = (next: number) => {
    const s = state.current;
    const target = Math.max(0, Math.round(next));
    const diff = target - Math.max(0, latest.current.storeQuantity + s.pending);
    if (diff === 0) return;
    if (Math.abs(diff) === 1) {
      s.pending += diff;
      setPending(s.pending);
      clearTimeout(s.timer);
      s.timer = setTimeout(() => flushRef.current(), FLUSH_MS);
      return;
    }
    // A typed number: write what was stepped so far, then record the count.
    flush();
    const l = latest.current;
    if (l.pantryId) recountStock(l.pantryId, l.productId, target, 'stepper');
  };

  return { value, setValue, flush };
}
