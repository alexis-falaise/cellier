import { describe, expect, it } from 'vitest';
import {
  closedTop,
  decideEdgePop,
  decidePage,
  decideSheetRelease,
  decideSwipeRelease,
  detentTop,
  edgeParentX,
  lockAxis,
  nextArmed,
  project,
  repeatInterval,
  rubberBand,
  rubberBandClamp,
  sheetDismissThreshold,
  sheetDragTop,
  shouldDismissToast,
  swipeDragX,
  toastDragY,
  toastOpacityForY,
  VelocityTracker,
} from './gesture';
import { presets, releaseTransition } from './presets';

describe('project', () => {
  it('matches the derived values of 02 §1.4', () => {
    expect(project(300)).toBeCloseTo(149.7, 1);
    expect(project(500)).toBeCloseTo(249.5, 1);
    expect(project(1000)).toBeCloseTo(499, 0);
    expect(project(2000)).toBeCloseTo(998, 0);
  });
  it('is signed and zero at rest', () => {
    expect(project(-1000)).toBeCloseTo(-499, 0);
    expect(project(0)).toBe(0);
  });
});

describe('rubberBand', () => {
  it('matches the sheet example of 02 §1.5', () => {
    expect(rubberBand(100, 32)).toBeCloseTo(20.23, 2);
    expect(rubberBand(300, 32)).toBeCloseTo(26.8, 1);
  });
  it('never exceeds d and keeps the sign', () => {
    expect(rubberBand(1e9, 48)).toBeLessThan(48);
    expect(rubberBand(-100, 24)).toBeLessThan(0);
    expect(Math.abs(rubberBand(-100, 24))).toBeCloseTo(rubberBand(100, 24));
  });
  it('clamps only outside the range', () => {
    expect(rubberBandClamp(50, 0, 100, 32)).toBe(50);
    expect(rubberBandClamp(-100, 0, 100, 32)).toBeCloseTo(-20.23, 2);
    expect(rubberBandClamp(200, 0, 100, 32)).toBeCloseTo(120.23, 2);
  });
});

describe('lockAxis', () => {
  it('waits for the threshold', () => {
    expect(lockAxis(5, 5, 10)).toBeNull();
  });
  it('locks horizontal within about 35°', () => {
    expect(lockAxis(20, 13, 10)).toBe('x');
    expect(lockAxis(20, 15, 10)).toBe('y');
    expect(lockAxis(0, -12, 10)).toBe('y');
  });
});

describe('VelocityTracker', () => {
  it('computes px/s over the last 80 ms', () => {
    const t = new VelocityTracker();
    for (let i = 0; i <= 10; i++) t.add(i * 10, i * 10);
    expect(t.velocity(100)).toBeCloseTo(1000, 0);
  });
  it('returns 0 when the finger stopped before lifting', () => {
    const t = new VelocityTracker();
    t.add(0, 0);
    t.add(50, 20);
    expect(t.velocity(100)).toBe(0);
  });
  it('returns 0 when the samples span under 16 ms', () => {
    const t = new VelocityTracker();
    t.add(0, 0);
    t.add(10, 8);
    expect(t.velocity(8)).toBe(0);
  });
  it('ignores samples older than 80 ms', () => {
    const t = new VelocityTracker();
    t.add(0, 0);
    t.add(1000, 10);
    for (let i = 0; i <= 8; i++) t.add(1000 + i * 5, 100 + i * 10);
    expect(t.velocity(180)).toBeCloseTo(500, 0);
  });
});

describe('sheet geometry', () => {
  const g = { viewportHeight: 844, safeTop: 47, contentHeight: 300 };
  it('places detents', () => {
    expect(detentTop('large', g)).toBe(57);
    expect(detentTop('medium', g)).toBe(422);
    expect(detentTop('fit', g)).toBe(544);
    expect(detentTop('fit', { ...g, contentHeight: 2000 })).toBe(57);
    expect(closedTop(g)).toBe(884);
  });
  it('rubber-bands above the highest detent', () => {
    expect(sheetDragTop(300, 57)).toBe(300);
    expect(sheetDragTop(57 - 100, 57)).toBeCloseTo(57 - 20.23, 2);
  });
});

describe('decideSheetRelease', () => {
  const H = 844;
  const large = 57;
  const medium = 422;
  const closed = H + 40;
  const base = { viewportHeight: H, closedTop: closed, dismissible: true };

  it('dismisses a slow release past 25 % of the visible height', () => {
    const threshold = sheetDismissThreshold(medium, H);
    expect(threshold).toBeCloseTo(422 + 0.25 * 422);
    const r = decideSheetRelease({ ...base, top: threshold + 1, velocity: 0, startTop: medium, detentTops: [medium] });
    expect(r.kind).toBe('dismiss');
  });
  it('returns to the detent for a slow short drag', () => {
    const r = decideSheetRelease({ ...base, top: medium + 40, velocity: 50, startTop: medium, detentTops: [medium] });
    expect(r).toEqual({ kind: 'detent', top: medium });
  });
  it('vetoes dismissal when the finger moves up', () => {
    const r = decideSheetRelease({ ...base, top: 800, velocity: -150, startTop: medium, detentTops: [medium] });
    expect(r).toEqual({ kind: 'detent', top: medium });
  });
  it('a fast downward flick from large goes at least one step down', () => {
    const r = decideSheetRelease({
      ...base,
      top: large + 5,
      velocity: 450,
      startTop: large,
      detentTops: [large, medium],
    });
    expect(r).toEqual({ kind: 'detent', top: medium });
  });
  it('a hard flick from large projects to dismissal', () => {
    const r = decideSheetRelease({
      ...base,
      top: large + 80,
      velocity: 2500,
      startTop: large,
      detentTops: [large, medium],
    });
    expect(r.kind).toBe('dismiss');
  });
  it('a fast upward flick from medium goes to large', () => {
    const r = decideSheetRelease({
      ...base,
      top: medium - 10,
      velocity: -500,
      startTop: medium,
      detentTops: [large, medium],
    });
    expect(r).toEqual({ kind: 'detent', top: large });
  });
  it('a downward release cannot go up a detent', () => {
    const r = decideSheetRelease({
      ...base,
      top: 200,
      velocity: 150,
      startTop: medium,
      detentTops: [large, medium],
    });
    expect(r).toEqual({ kind: 'detent', top: medium });
  });
  it('never dismisses a non-dismissible sheet', () => {
    const r = decideSheetRelease({
      ...base,
      dismissible: false,
      top: 840,
      velocity: 3000,
      startTop: medium,
      detentTops: [medium],
    });
    expect(r).toEqual({ kind: 'detent', top: medium });
  });
});

describe('swipe rows', () => {
  const cfg = { rowWidth: 358, leadingCount: 1, trailingCount: 1 };
  it('rubber-bands the side without actions', () => {
    expect(swipeDragX(100, { ...cfg, leadingCount: 0 })).toBeCloseTo(rubberBand(100, 48));
    expect(swipeDragX(-100, cfg)).toBe(-100);
  });
  it('arms at 0.6 × width with 16 px hysteresis', () => {
    expect(nextArmed(-214, 358, false)).toBe(false);
    expect(nextArmed(-215, 358, false)).toBe(true);
    expect(nextArmed(-200, 358, true)).toBe(true);
    expect(nextArmed(-198, 358, true)).toBe(false);
  });
  it('opens past half the reveal width', () => {
    expect(decideSwipeRelease({ ...cfg, x: -40, velocity: 0, armed: false })).toEqual({
      kind: 'open',
      x: -76,
      side: 'trailing',
    });
    expect(decideSwipeRelease({ ...cfg, x: -30, velocity: 0, armed: false })).toEqual({ kind: 'closed', x: 0 });
  });
  it('opens on projection', () => {
    expect(decideSwipeRelease({ ...cfg, x: -20, velocity: -300, armed: false }).kind).toBe('open');
  });
  it('commits when armed or flicked', () => {
    expect(decideSwipeRelease({ ...cfg, x: -230, velocity: 0, armed: true })).toEqual({
      kind: 'commit',
      x: -358,
      side: 'trailing',
    });
    expect(decideSwipeRelease({ ...cfg, x: 90, velocity: 1300, armed: false }).kind).toBe('commit');
  });
  it('the velocity veto stops a commit and an open', () => {
    expect(decideSwipeRelease({ ...cfg, x: -230, velocity: 250, armed: true }).kind).toBe('closed');
    expect(decideSwipeRelease({ ...cfg, x: -60, velocity: 150, armed: false }).kind).toBe('closed');
  });
  it('a side without actions always closes', () => {
    expect(decideSwipeRelease({ ...cfg, trailingCount: 0, x: -40, velocity: -900, armed: false }).kind).toBe('closed');
  });
});

describe('toasts', () => {
  it('dismisses by distance or velocity', () => {
    expect(shouldDismissToast(45, 0)).toBe(true);
    expect(shouldDismissToast(10, 110)).toBe(true);
    expect(shouldDismissToast(30, 50)).toBe(false);
  });
  it('rubber-bands upward', () => {
    expect(toastDragY(20)).toBe(20);
    expect(toastDragY(-200)).toBeGreaterThan(-24);
  });
  it('fades over the last half of the exit', () => {
    expect(toastOpacityForY(40, 100)).toBe(1);
    expect(toastOpacityForY(75, 100)).toBeCloseTo(0.5);
    expect(toastOpacityForY(100, 100)).toBe(0);
  });
});

describe('edge back and paging', () => {
  it('pops by velocity or projected position', () => {
    expect(decideEdgePop(10, 300, 390)).toBe(true);
    expect(decideEdgePop(300, -300, 390)).toBe(false);
    expect(decideEdgePop(150, 100, 390)).toBe(true);
    expect(decideEdgePop(100, 0, 390)).toBe(false);
  });
  it('moves the parent by 30 % of the width', () => {
    expect(edgeParentX(0, 390)).toBeCloseTo(-117);
    expect(edgeParentX(390, 390)).toBeCloseTo(0);
  });
  it('pages at most one step per gesture', () => {
    expect(decidePage(0, -250, 0, 390, 4)).toBe(1);
    expect(decidePage(1, -50, -2000, 390, 4)).toBe(2);
    expect(decidePage(0, 100, 900, 390, 4)).toBe(0);
    expect(decidePage(3, -300, -900, 390, 4)).toBe(3);
  });
});

describe('release transitions', () => {
  it('hands off velocity with fling at 100 px/s or more', () => {
    expect(releaseTransition(450, 'sheet', false)).toEqual({ ...presets.fling, velocity: 450 });
    expect(releaseTransition(50, 'sheet', false)).toEqual({ ...presets.sheet, velocity: 50 });
  });
  it('uses snappy without bounce under reduced motion', () => {
    expect(releaseTransition(900, 'smooth', true)).toEqual({ ...presets.snappy, velocity: 900 });
  });
});

describe('stepper repeat', () => {
  it('starts after 400 ms and accelerates every second up to 10 steps/s', () => {
    expect(repeatInterval(399)).toBeNull();
    expect(repeatInterval(400)).toBe(250);
    expect(repeatInterval(1500)).toBeCloseTo(1000 / 7);
    expect(repeatInterval(9000)).toBe(100);
  });
});
