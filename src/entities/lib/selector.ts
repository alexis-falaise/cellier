/**
 * Tiny memoisation helpers for store selectors. A selector recomputes only when one of its inputs
 * (usually snapshot maps, which keep their identity when unchanged) is a different object, and
 * returns the previous result when the new one is element-wise identical.
 */
import type { CellierSnapshot } from '@/shared/sync';

export type Selector<T> = (s: CellierSnapshot) => T;

export function sameArray<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/** Same own keys with identical values. */
export function sameShallow(a: object, b: object): boolean {
  if (a === b) return true;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) {
    if ((a as Record<string, unknown>)[k] !== (b as Record<string, unknown>)[k]) return false;
  }
  return true;
}

function isPlainObject(x: unknown): x is object {
  return !!x && typeof x === 'object' && Object.getPrototypeOf(x) === Object.prototype;
}

/** Keeps the previous array/object when the new one is equal element-wise / key-wise. */
export function stabilize<T>(previous: T | undefined, next: T): T {
  if (previous === undefined) return next;
  if (Array.isArray(previous) && Array.isArray(next)) return sameArray(previous, next) ? previous : next;
  if (isPlainObject(previous) && isPlainObject(next)) return sameShallow(previous, next) ? previous : next;
  return Object.is(previous, next) ? previous : next;
}

/** Memoised selector over a tuple of inputs compared by identity. */
export function createSelector<I extends readonly unknown[], R>(
  inputs: (s: CellierSnapshot) => I,
  combine: (...args: [...I]) => R,
): Selector<R> {
  let lastInputs: I | null = null;
  let lastResult: R | undefined;
  return (s) => {
    const next = inputs(s);
    if (lastInputs && sameArray(lastInputs, next)) return lastResult as R;
    lastInputs = next;
    lastResult = stabilize(lastResult, combine(...(next as unknown as [...I])));
    return lastResult;
  };
}

/** One memoised selector per key (product id, pantry id…), bounded LRU. */
export function keyedSelector<K, R>(factory: (key: K) => Selector<R>, max = 200): (key: K) => Selector<R> {
  const cache = new Map<K, Selector<R>>();
  return (key) => {
    let selector = cache.get(key);
    if (selector) {
      cache.delete(key);
    } else {
      selector = factory(key);
      if (cache.size >= max) {
        const oldest = cache.keys().next();
        if (!oldest.done) cache.delete(oldest.value);
      }
    }
    cache.set(key, selector);
    return selector;
  };
}

const collator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });
export const compareFr = (a: string, b: string) => collator.compare(a, b);
