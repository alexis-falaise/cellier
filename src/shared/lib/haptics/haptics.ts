/*
 * The single haptic of Cellier, at four sites only (02 §5).
 * iOS 18+: a hidden <label><input type="checkbox" switch></label>; label.click() inside a user-gesture handler plays
 * the system switch tick. Android: navigator.vibrate. Elsewhere: no-op. Call synchronously from the event handler
 * that causes the change, never from effects, timers, rAF or promise continuations.
 */

export type HapticSite = 'scan' | 'commit' | 'switch' | 'destructive';
export type HapticSupport = 'ios-switch' | 'vibrate' | 'none';

const VIBRATE_PATTERNS: Record<HapticSite, number[]> = {
  scan: [12],
  commit: [8],
  destructive: [20, 60, 20],
  switch: [6],
};

const THROTTLE_MS = 100;
const STORAGE_KEY = 'cellier.haptics.enabled';
const SCAN_TEST_KEY = 'cellier.haptics.scanTest';

function envFlag(value: unknown, fallback: boolean): boolean {
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return fallback;
}

/**
 * Device-test gates (02 §5.3, §5.5). `scanHaptic` stays off until the asynchronous worker test passes on device;
 * `hapticAtCrossing` falls back to firing on commit at pointer-up when false.
 */
export const hapticFlags = {
  scanHaptic: envFlag(import.meta.env.VITE_SCAN_HAPTIC, false),
  hapticAtCrossing: envFlag(import.meta.env.VITE_HAPTIC_AT_CROSSING, true),
};

function readStorage(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Private mode or blocked storage: the preference lives for the session only.
  }
}

/** Per-device flag used while running the scan-haptic device test (02 §5.5 protocol). */
export function isScanHapticTestEnabled(): boolean {
  return readStorage(SCAN_TEST_KEY) === '1';
}

export function setScanHapticTest(on: boolean): void {
  writeStorage(SCAN_TEST_KEY, on ? '1' : '0');
}

export function isIOS(
  nav: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'> | undefined = globalThis.navigator,
): boolean {
  if (!nav) return false;
  if (/iPhone|iPad|iPod/.test(nav.userAgent)) return true;
  return nav.platform === 'MacIntel' && nav.maxTouchPoints > 1;
}

export function hapticSupport(): HapticSupport {
  if (typeof document === 'undefined' || typeof navigator === 'undefined') return 'none';
  if (isIOS()) return 'switch' in HTMLInputElement.prototype ? 'ios-switch' : 'none';
  if (typeof navigator.vibrate === 'function') return 'vibrate';
  return 'none';
}

let enabledCache: boolean | null = null;

export function isHapticsEnabled(): boolean {
  if (enabledCache === null) enabledCache = readStorage(STORAGE_KEY) !== '0';
  return enabledCache;
}

/** «Retours haptiques» (02 §5.4): stored per device, not synced. */
export function setHapticsEnabled(on: boolean): void {
  enabledCache = on;
  writeStorage(STORAGE_KEY, on ? '1' : '0');
}

let label: HTMLLabelElement | null = null;

/** Creates the hidden switch once and keeps it in the DOM. Safe to call repeatedly. */
export function mountHapticSwitch(): HTMLLabelElement | null {
  if (typeof document === 'undefined') return null;
  if (label?.isConnected) return label;
  const el = document.createElement('label');
  el.setAttribute('aria-hidden', 'true');
  el.dataset.haptic = '';
  el.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');
  el.appendChild(input);
  const stop = (e: Event) => e.stopPropagation();
  el.addEventListener('click', stop);
  input.addEventListener('click', stop);
  document.body.appendChild(el);
  label = el;
  return el;
}

let lastFiredAt = Number.NEGATIVE_INFINITY;

/** Pure throttle decision, exported for tests. */
export function shouldFire(now: number, last: number, throttleMs: number = THROTTLE_MS): boolean {
  return now - last >= throttleMs;
}

/**
 * Plays the haptic for a site. Returns whether a haptic was attempted (iOS gives no way to know if it played).
 * Site `switch` is a no-op on iOS: the native switch ticks by itself; Android gets a parity tick.
 */
export function haptic(site: HapticSite): boolean {
  if (!isHapticsEnabled()) return false;
  if (site === 'scan' && !hapticFlags.scanHaptic && !isScanHapticTestEnabled()) {
    // Android keeps the scan tick: vibrate uses sticky activation and works from a worker result.
    if (hapticSupport() !== 'vibrate') return false;
  }
  const support = hapticSupport();
  if (support === 'none') return false;
  if (support === 'ios-switch' && site === 'switch') return false;
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (!shouldFire(now, lastFiredAt)) return false;
  lastFiredAt = now;
  if (support === 'vibrate') {
    try {
      return navigator.vibrate(VIBRATE_PATTERNS[site]);
    } catch {
      return false;
    }
  }
  const el = mountHapticSwitch();
  if (!el) return false;
  el.click();
  return true;
}

/**
 * Site 2 helper for one gesture: at most one haptic per gesture. With `hapticAtCrossing` the tick fires when the
 * drag arms its commit; otherwise it fires on pointer-up when the release actually commits.
 */
export function createCommitHaptic() {
  let fired = false;
  return {
    /** Call from pointermove when the commit threshold is crossed (armed). */
    arm(): void {
      if (fired || !hapticFlags.hapticAtCrossing) return;
      fired = haptic('commit') || fired;
    },
    /** Call from pointerup when the release commits. */
    commit(): void {
      if (fired || hapticFlags.hapticAtCrossing) return;
      fired = haptic('commit') || fired;
    },
    /** Re-arms after the drag returns past the hysteresis (sheets: 16 px). */
    rearm(): void {
      fired = false;
    },
    reset(): void {
      fired = false;
    },
  };
}

export type CommitHaptic = ReturnType<typeof createCommitHaptic>;
