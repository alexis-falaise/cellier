/*
 * Pure gesture maths shared by sheets, swipe rows, toasts, the edge swipe and paging (02 §1.3–1.5, §3).
 * Velocities are px/s; positions are px. No DOM access here, so everything is unit-tested.
 */

export const DECELERATION_RATE = 0.998;
export const RUBBER_BAND_C = 0.55;

export const THRESHOLDS = {
  activationTouch: 10,
  activationPointer: 4,
  axisLockRatio: 0.7,
  stationaryVelocity: 100,
  overshootBleed: 40,
  hapticThrottleMs: 100,
  press: {
    minVisibleMs: 80,
    scrollHighlightDelayMs: 80,
    cancelDistance: 10,
  },
  velocity: {
    windowMs: 80,
    minSpanMs: 16,
    staleMs: 60,
  },
  sheet: {
    largeOffset: 10,
    rubberBand: 32,
    fastVelocity: 400,
    vetoVelocity: 100,
    dismissFraction: 0.25,
    hapticRearm: 16,
    scrollLockMs: 100,
  },
  swipe: {
    actionWidth: 76,
    openFraction: 0.5,
    commitFraction: 0.6,
    flickVelocity: 1200,
    disarmHysteresis: 16,
    vetoVelocity: 200,
    rubberBand: 48,
  },
  toast: {
    dismissDistance: 45,
    dismissVelocity: 110,
    rubberBand: 24,
    lifetimeMs: 4000,
    lifetimeWithActionMs: 6000,
    lifetimeFocusedMs: 10000,
  },
  edgeBack: {
    startZone: 24,
    velocity: 300,
    parentOffset: 0.3,
  },
  paging: {
    rubberBand: 48,
  },
  longPress: {
    durationMs: 450,
    hintMs: 300,
    hintFadeMs: 120,
  },
  stepper: {
    repeatDelayMs: 400,
    accelerateEveryMs: 1000,
    rates: [4, 7, 10],
  },
} as const;

/** Apple's projection (WWDC18): extra travel under scroll-like deceleration. */
export function project(velocity: number, decelerationRate: number = DECELERATION_RATE): number {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** UIScrollView rubber band: `x` past the boundary, `d` the asymptote. Keeps the sign of `x`. */
export function rubberBand(x: number, d: number, c: number = RUBBER_BAND_C): number {
  if (d <= 0) return 0;
  return (x * d * c) / (d + c * Math.abs(x));
}

/** Applies the rubber band outside [min, max]; identity inside. */
export function rubberBandClamp(value: number, min: number, max: number, d: number): number {
  if (value < min) return min + rubberBand(value - min, d);
  if (value > max) return max + rubberBand(value - max, d);
  return value;
}

export function activationThreshold(pointerType: string): number {
  return pointerType === 'touch' ? THRESHOLDS.activationTouch : THRESHOLDS.activationPointer;
}

export type Axis = 'x' | 'y';

/** Decides the axis once, at activation. Returns null while under the activation threshold. */
export function lockAxis(dx: number, dy: number, threshold: number): Axis | null {
  if (Math.hypot(dx, dy) < threshold) return null;
  return Math.abs(dy) <= THRESHOLDS.axisLockRatio * Math.abs(dx) ? 'x' : 'y';
}

interface Sample {
  t: number;
  p: number;
}

/** Velocity from our own pointer history (02 §1.3): last 80 ms, span ≥ 16 ms, 0 if the finger stopped. */
export class VelocityTracker {
  private samples: Sample[] = [];

  reset(): void {
    this.samples = [];
  }

  add(position: number, time: number): void {
    this.samples.push({ t: time, p: position });
    const cutoff = time - THRESHOLDS.velocity.windowMs;
    while (this.samples.length > 2 && (this.samples[0] as Sample).t < cutoff) this.samples.shift();
  }

  velocity(now: number): number {
    const { samples } = this;
    const last = samples[samples.length - 1];
    if (!last || now - last.t > THRESHOLDS.velocity.staleMs) return 0;
    const cutoff = last.t - THRESHOLDS.velocity.windowMs;
    const first = samples.find((s) => s.t >= cutoff);
    if (!first) return 0;
    const span = last.t - first.t;
    if (span < THRESHOLDS.velocity.minSpanMs) return 0;
    return ((last.p - first.p) / span) * 1000;
  }
}

function nearest(values: readonly number[], target: number): number {
  let best = values[0] as number;
  for (const v of values) if (Math.abs(v - target) < Math.abs(best - target)) best = v;
  return best;
}

// ---------------------------------------------------------------------------------------------
// Sheets (02 §3.2)
// ---------------------------------------------------------------------------------------------

export type Detent = 'fit' | 'medium' | 'large';

export interface SheetGeometry {
  /** Layout viewport height. */
  viewportHeight: number;
  /** Safe-area top inset. */
  safeTop: number;
  /** Natural height of the sheet content (used by `fit`). */
  contentHeight?: number;
}

export function detentTop(detent: Detent, g: SheetGeometry): number {
  const largeTop = g.safeTop + THRESHOLDS.sheet.largeOffset;
  switch (detent) {
    case 'large':
      return largeTop;
    case 'medium':
      return Math.max(largeTop, 0.5 * g.viewportHeight);
    case 'fit':
      return Math.max(largeTop, g.viewportHeight - (g.contentHeight ?? g.viewportHeight));
  }
}

export function closedTop(g: SheetGeometry): number {
  return g.viewportHeight + THRESHOLDS.overshootBleed;
}

export interface SheetReleaseInput {
  /** Current sheet top (px from the viewport top). */
  top: number;
  /** Release velocity, positive downward. */
  velocity: number;
  /** Top of the detent the gesture started at. */
  startTop: number;
  /** Tops of the allowed detents. */
  detentTops: readonly number[];
  /** Top when closed (off-screen). */
  closedTop: number;
  viewportHeight: number;
  dismissible: boolean;
}

export type SheetReleaseTarget = { kind: 'detent'; top: number } | { kind: 'dismiss'; top: number };

/** Release algorithm of 02 §3.2: velocity veto, fast projection with one step minimum, slow 25 % rule. */
export function decideSheetRelease(input: SheetReleaseInput): SheetReleaseTarget {
  const { top, velocity: v, startTop, closedTop: closed, viewportHeight, dismissible } = input;
  const S = THRESHOLDS.sheet;
  const detents = [...new Set(input.detentTops)].sort((a, b) => a - b);
  const highest = detents[0] as number;
  const lowestDetent = detents[detents.length - 1] as number;

  const movingUp = v < -S.vetoVelocity;
  const movingDown = v > S.vetoVelocity;
  // Steps relative to the starting detent; the veto removes the forbidden direction.
  const allowed = detents.filter((d) => {
    if (movingUp && d > startTop) return false;
    if (movingDown && d < startTop) return false;
    return true;
  });
  const canDismiss = dismissible && !movingUp;
  const candidates = canDismiss ? [...allowed, closed] : allowed;
  if (candidates.length === 0) return { kind: 'detent', top: startTop };

  const projected = top + project(v);
  const toTarget = (t: number): SheetReleaseTarget =>
    t === closed ? { kind: 'dismiss', top: closed } : { kind: 'detent', top: t };

  if (Math.abs(v) >= S.fastVelocity) {
    let target = nearest(candidates, projected);
    // At least one step in the direction of v.
    if (v > 0 && target <= startTop) {
      const below = candidates.filter((c) => c > startTop).sort((a, b) => a - b);
      if (below.length > 0) target = below[0] as number;
    } else if (v < 0 && target >= startTop) {
      const above = candidates.filter((c) => c < startTop).sort((a, b) => b - a);
      if (above.length > 0) target = above[0] as number;
    }
    return toTarget(target);
  }

  // Slow release: dismiss once the sheet is 25 % of the lowest detent's visible height below that detent.
  if (canDismiss && top >= sheetDismissThreshold(lowestDetent, viewportHeight)) return toTarget(closed);
  return toTarget(nearest(allowed.length > 0 ? allowed : [highest], projected));
}

/** The y at which a drag crosses the dismissal threshold (haptic site 2), measured from the lowest detent. */
export function sheetDismissThreshold(lowestDetentTop: number, viewportHeight: number): number {
  return lowestDetentTop + THRESHOLDS.sheet.dismissFraction * (viewportHeight - lowestDetentTop);
}

/** Tracks the sheet top during a drag: 1:1, rubber band above the highest detent. */
export function sheetDragTop(rawTop: number, highestDetentTop: number): number {
  if (rawTop >= highestDetentTop) return rawTop;
  return highestDetentTop + rubberBand(rawTop - highestDetentTop, THRESHOLDS.sheet.rubberBand);
}

// ---------------------------------------------------------------------------------------------
// Swipe-to-act rows (02 §3.3)
// ---------------------------------------------------------------------------------------------

export interface SwipeConfig {
  rowWidth: number;
  leadingCount: number;
  trailingCount: number;
}

/** Row offset while dragging: 1:1 inside the reachable range, rubber band on a side without actions. */
export function swipeDragX(rawX: number, cfg: SwipeConfig): number {
  const d = THRESHOLDS.swipe.rubberBand;
  if (rawX > 0 && cfg.leadingCount === 0) return rubberBand(rawX, d);
  if (rawX < 0 && cfg.trailingCount === 0) return rubberBand(rawX, d);
  return rawX;
}

export function commitArmDistance(rowWidth: number): number {
  return THRESHOLDS.swipe.commitFraction * rowWidth;
}

/** Arming with hysteresis: arms at 0.6 × width, disarms 16 px below it. */
export function nextArmed(x: number, rowWidth: number, armed: boolean): boolean {
  const arm = commitArmDistance(rowWidth);
  const ax = Math.abs(x);
  if (armed) return ax >= arm - THRESHOLDS.swipe.disarmHysteresis;
  return ax >= arm;
}

export type SwipeReleaseTarget =
  | { kind: 'closed'; x: 0 }
  | { kind: 'open'; x: number; side: 'leading' | 'trailing' }
  | { kind: 'commit'; x: number; side: 'leading' | 'trailing' };

export interface SwipeReleaseInput extends SwipeConfig {
  x: number;
  velocity: number;
  armed: boolean;
}

export function decideSwipeRelease(input: SwipeReleaseInput): SwipeReleaseTarget {
  const { x, velocity: v, rowWidth, armed } = input;
  const S = THRESHOLDS.swipe;
  if (x === 0) return { kind: 'closed', x: 0 };
  const side = x > 0 ? 'leading' : 'trailing';
  const count = side === 'leading' ? input.leadingCount : input.trailingCount;
  if (count === 0) return { kind: 'closed', x: 0 };
  const sign = x > 0 ? 1 : -1;
  const R = count * S.actionWidth;
  const ax = Math.abs(x);
  const towardClosed = -sign * v; // positive when moving back toward 0
  const vetoed = towardClosed > S.vetoVelocity;
  const opening = sign * v > 0;

  if (!vetoed) {
    if (armed) return { kind: 'commit', x: sign * rowWidth, side };
    if (ax >= R && opening && Math.abs(v) >= S.flickVelocity) return { kind: 'commit', x: sign * rowWidth, side };
  }
  const pointsBack = towardClosed > 0 && Math.abs(v) >= THRESHOLDS.stationaryVelocity;
  if (!pointsBack && Math.abs(x + project(v)) >= S.openFraction * R) return { kind: 'open', x: sign * R, side };
  return { kind: 'closed', x: 0 };
}

// ---------------------------------------------------------------------------------------------
// Toasts (02 §3.7)
// ---------------------------------------------------------------------------------------------

export function toastDragY(rawY: number): number {
  return rawY >= 0 ? rawY : rubberBand(rawY, THRESHOLDS.toast.rubberBand);
}

export function shouldDismissToast(dy: number, velocity: number): boolean {
  return dy >= THRESHOLDS.toast.dismissDistance || velocity >= THRESHOLDS.toast.dismissVelocity;
}

/** Toast opacity during a swipe: 1 until 50 % of the exit distance, then linear to 0. */
export function toastOpacityForY(y: number, exitY: number): number {
  if (exitY <= 0) return 1;
  const progress = y / exitY;
  if (progress <= 0.5) return 1;
  return Math.max(0, 1 - (progress - 0.5) / 0.5);
}

// ---------------------------------------------------------------------------------------------
// Edge-swipe back (02 §3.6) and paging (02 §3.9)
// ---------------------------------------------------------------------------------------------

export function isEdgeStart(clientX: number): boolean {
  return clientX <= THRESHOLDS.edgeBack.startZone;
}

export function decideEdgePop(x: number, velocity: number, width: number): boolean {
  if (velocity >= THRESHOLDS.edgeBack.velocity) return true;
  if (velocity <= -THRESHOLDS.edgeBack.velocity) return false;
  return x + project(velocity) >= 0.5 * width;
}

/** Parent offset while the top screen is at `x` (0 = fully pushed). */
export function edgeParentX(x: number, width: number): number {
  if (width <= 0) return 0;
  return -THRESHOLDS.edgeBack.parentOffset * width * (1 - x / width);
}

export function decidePage(current: number, offset: number, velocity: number, width: number, count: number): number {
  if (width <= 0 || count <= 0) return current;
  const projected = offset + project(velocity);
  // Offset is the drag delta: negative moves to the next page.
  const delta = Math.round(-projected / width);
  const step = Math.max(-1, Math.min(1, delta));
  return Math.max(0, Math.min(count - 1, current + step));
}

// ---------------------------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------------------------

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Stepper hold-to-repeat interval for the time the button has been held (02/04: 400 ms, then accelerating). */
export function repeatInterval(heldMs: number): number | null {
  const S = THRESHOLDS.stepper;
  if (heldMs < S.repeatDelayMs) return null;
  const tier = Math.min(S.rates.length - 1, Math.floor((heldMs - S.repeatDelayMs) / S.accelerateEveryMs));
  return 1000 / (S.rates[tier] as number);
}
