import { useSyncExternalStore } from 'react';

/**
 * A coarse clock for forecasts and relative dates: it ticks every 5 minutes while someone listens
 * and when the app comes back to the foreground. Between ticks the value keeps its identity, so
 * memoised derivations do not recompute on every render.
 */
const TICK_MS = 5 * 60_000;

let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function tick() {
  now = Date.now();
  for (const l of [...listeners]) l();
}

function onVisibility() {
  if (document.visibilityState === 'visible') tick();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    now = Date.now();
    timer = setInterval(tick, TICK_MS);
    document.addEventListener('visibilitychange', onVisibility);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      if (timer !== null) clearInterval(timer);
      timer = null;
      document.removeEventListener('visibilitychange', onVisibility);
    }
  };
}

const read = () => now;

export function useNow(): number {
  return useSyncExternalStore(subscribe, read, read);
}
