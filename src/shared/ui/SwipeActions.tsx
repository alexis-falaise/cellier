import type { LucideIcon } from 'lucide-react';
import {
  type AnimationPlaybackControls,
  animate,
  type MotionValue,
  m,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from 'motion/react';
import { type ReactNode, type PointerEvent as ReactPointerEvent, useEffect, useRef } from 'react';
import { createCommitHaptic } from '@/shared/lib/haptics';
import {
  activationThreshold,
  clamp,
  decideSwipeRelease,
  lockAxis,
  nextArmed,
  presets,
  releaseTransition,
  swipeDragX,
  THRESHOLDS,
  VelocityTracker,
} from '@/shared/lib/motion';
import { cx } from './cx';
import { useElevatedSurface } from './surface';

export interface SwipeAction {
  /** Visible label, e.g. «+1»; also the VoiceOver action name unless `accessibleLabel` is given. */
  label: string;
  accessibleLabel?: string | undefined;
  icon?: LucideIcon | undefined;
  tone: 'accent' | 'danger' | 'warning' | 'neutral';
  onAction: () => void;
  /** The row slides out and stays out (it is about to be removed). Otherwise it springs back after committing. */
  removesRow?: boolean | undefined;
}

export interface SwipeActionsProps {
  /** Leading actions (revealed by a swipe to the right), the first is primary. At most 2. */
  leading?: SwipeAction[] | undefined;
  /** Trailing actions (revealed by a swipe to the left), the first is primary. At most 2. */
  trailing?: SwipeAction[] | undefined;
  children: ReactNode;
  disabled?: boolean | undefined;
  className?: string | undefined;
}

const TONE: Record<SwipeAction['tone'], string> = {
  accent: 'bg-accent text-on-accent',
  danger: 'bg-danger text-on-accent',
  warning: 'bg-amber-600 text-on-accent',
  neutral: 'bg-stone-500 text-on-accent',
};

type CloseFn = () => void;
let openRowClose: CloseFn | null = null;

interface DragState {
  id: number;
  pointerType: string;
  startX: number;
  startY: number;
  originX: number;
  phase: 'idle' | 'pending' | 'drag';
  armed: boolean;
  width: number;
}

/**
 * Swipe-to-act row (02 §3.3, 04 §3): 1:1 tracking after a horizontal axis lock, 76 px actions, open past half the
 * reveal width, full swipe arms at 0.6 × row width (haptic site 2) with 16 px hysteresis, release with `fling`.
 * Only one row is open at a time; a scroll closes it. Actions are also exposed as buttons for assistive tech.
 */
export function SwipeActions({ leading = [], trailing = [], children, disabled, className }: SwipeActionsProps) {
  const reduced = useReducedMotion();
  const elevated = useElevatedSurface();
  const rootRef = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const armProgress = useMotionValue(0);
  const anim = useRef<AnimationPlaybackControls | null>(null);
  const tracker = useRef(new VelocityTracker());
  const commitHaptic = useRef(createCommitHaptic());
  const drag = useRef<DragState>({
    id: -1,
    pointerType: 'touch',
    startX: 0,
    startY: 0,
    originX: 0,
    phase: 'idle',
    armed: false,
    width: 0,
  });

  const run = (target: number, transition: Parameters<typeof animate>[2]) => {
    anim.current?.stop();
    anim.current = animate(x, target, transition as never);
  };

  const close = () => {
    run(0, reduced ? presets.snappy : presets.smooth);
    if (openRowClose === close) openRowClose = null;
  };

  const setArmed = (armed: boolean) => {
    drag.current.armed = armed;
    animate(armProgress, armed ? 1 : 0, reduced ? { duration: 0 } : presets.snappy);
  };

  const closeRef = useRef<CloseFn>(close);
  useEffect(() => {
    closeRef.current = close;
  });

  // A scroll anywhere closes the open row.
  // biome-ignore lint/correctness/useExhaustiveDependencies: listener set up once
  useEffect(() => {
    const onScroll = () => {
      if (openRowClose === closeRef.current && x.get() !== 0 && drag.current.phase !== 'drag') close();
    };
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll, { capture: true });
      if (openRowClose === closeRef.current) openRowClose = null;
    };
  }, []);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const d = drag.current;
    d.id = e.pointerId;
    d.pointerType = e.pointerType;
    d.startX = e.clientX;
    d.startY = e.clientY;
    d.phase = 'pending';
    d.width = rootRef.current?.offsetWidth ?? 0;
    tracker.current.reset();
    tracker.current.add(e.clientX, e.timeStamp);
    commitHaptic.current.reset();
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d.id !== e.pointerId || d.phase === 'idle') return;
    tracker.current.add(e.clientX, e.timeStamp);
    if (d.phase === 'pending') {
      const axis = lockAxis(e.clientX - d.startX, e.clientY - d.startY, activationThreshold(d.pointerType));
      if (axis === null) return;
      if (axis === 'y') {
        d.phase = 'idle';
        return;
      }
      if (openRowClose && openRowClose !== closeRef.current) openRowClose();
      anim.current?.stop();
      d.phase = 'drag';
      d.originX = e.clientX - x.get();
      d.armed = false;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    const next = swipeDragX(e.clientX - d.originX, {
      rowWidth: d.width,
      leadingCount: leading.length,
      trailingCount: trailing.length,
    });
    x.set(next);
    const sideHasActions = next > 0 ? leading.length > 0 : trailing.length > 0;
    const armed = sideHasActions && nextArmed(next, d.width, d.armed);
    if (armed !== d.armed) {
      setArmed(armed);
      if (armed) commitHaptic.current.arm();
      else commitHaptic.current.rearm();
    }
  };

  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const d = drag.current;
    if (d.id !== e.pointerId) return;
    const wasDragging = d.phase === 'drag';
    d.id = -1;
    d.phase = 'idle';
    if (!wasDragging) return;
    const v = cancelled ? 0 : tracker.current.velocity(e.timeStamp);
    const decision = decideSwipeRelease({
      x: x.get(),
      velocity: v,
      armed: cancelled ? false : d.armed,
      rowWidth: d.width,
      leadingCount: leading.length,
      trailingCount: trailing.length,
    });
    if (d.armed) setArmed(false);
    if (decision.kind === 'commit') {
      const action = (decision.side === 'leading' ? leading : trailing)[0];
      if (!action) return;
      commitHaptic.current.commit();
      if (action.removesRow) {
        run(decision.x, releaseTransition(v, 'smooth', reduced));
      } else {
        run(0, releaseTransition(v, 'smooth', reduced));
      }
      if (openRowClose === closeRef.current) openRowClose = null;
      action.onAction();
      return;
    }
    run(decision.x, releaseTransition(v, 'smooth', reduced));
    if (decision.kind === 'open') openRowClose = closeRef.current;
    else if (openRowClose === closeRef.current) openRowClose = null;
  };

  const runAction = (action: SwipeAction) => {
    if (action.removesRow) run(x.get() >= 0 ? drag.current.width || 400 : -(drag.current.width || 400), presets.smooth);
    else close();
    action.onAction();
  };

  return (
    <div ref={rootRef} className={cx('relative overflow-hidden', className)}>
      {leading.length > 0 ? (
        <ActionLayer side="leading" actions={leading} x={x} armProgress={armProgress} onRun={runAction} />
      ) : null}
      {trailing.length > 0 ? (
        <ActionLayer side="trailing" actions={trailing} x={x} armProgress={armProgress} onRun={runAction} />
      ) : null}
      <m.div
        style={{ x }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => onPointerEnd(e, false)}
        onPointerCancel={(e) => onPointerEnd(e, true)}
        className={cx(
          'relative touch-pan-y',
          elevated ? 'bg-surface-elevated' : 'bg-surface',
          // Overshoot bleed on both sides.
          'before:absolute before:inset-y-0 before:right-full before:w-10 before:bg-inherit',
          'after:absolute after:inset-y-0 after:left-full after:w-10 after:bg-inherit',
        )}
      >
        {children}
      </m.div>
      <div className="sr-only">
        {[...leading, ...trailing].map((action) => (
          <button key={action.label} type="button" onClick={() => action.onAction()}>
            {action.accessibleLabel ?? action.label}
          </button>
        ))}
      </div>
    </div>
  );
}

interface ActionLayerProps {
  side: 'leading' | 'trailing';
  actions: SwipeAction[];
  x: MotionValue<number>;
  armProgress: MotionValue<number>;
  onRun: (action: SwipeAction) => void;
}

function ActionLayer({ side, actions, x, armProgress, onRun }: ActionLayerProps) {
  const W = THRESHOLDS.swipe.actionWidth;
  const sign = side === 'leading' ? 1 : -1;
  const primary = actions[0] as SwipeAction;
  const secondary = actions[1];
  const R = actions.length * W;
  // Visible only on its own side.
  const visibility = useTransform(x, (v) => (sign * v > 0 ? 1 : 0));
  // The primary glyph sticks to the content edge once armed, and grows as the commit approaches.
  const primaryShift = useTransform([x, armProgress], ([vx, p]) => {
    const stuck = Math.max(0, Math.abs(vx as number) - W);
    return sign * (p as number) * stuck;
  });
  const iconScale = useTransform(x, (v) => 0.85 + 0.15 * clamp(Math.abs(v) / R, 0, 1));
  const secondaryOpacity = useTransform(armProgress, [0, 1], [1, 0]);
  const PrimaryIcon = primary.icon;
  const SecondaryIcon = secondary?.icon;

  return (
    <m.div
      aria-hidden="true"
      className={cx('absolute inset-0 flex', side === 'leading' ? 'justify-start' : 'justify-end', TONE[primary.tone])}
      style={{ opacity: visibility }}
    >
      <div className={cx('relative flex h-full', side === 'leading' ? 'flex-row' : 'flex-row-reverse')}>
        <m.button
          type="button"
          tabIndex={-1}
          onClick={() => onRun(primary)}
          className="relative flex h-full flex-col items-center justify-center gap-0.5 type-footnote font-semibold"
          style={{ width: W, x: primaryShift }}
        >
          {PrimaryIcon ? (
            <m.span style={{ scale: iconScale }}>
              <PrimaryIcon size={20} strokeWidth={1.75} absoluteStrokeWidth />
            </m.span>
          ) : null}
          <m.span style={PrimaryIcon ? {} : { scale: iconScale }} className={PrimaryIcon ? '' : 'type-headline'}>
            {primary.label}
          </m.span>
        </m.button>
        {secondary ? (
          <m.button
            type="button"
            tabIndex={-1}
            onClick={() => onRun(secondary)}
            className={cx(
              'relative flex h-full flex-col items-center justify-center gap-0.5 type-footnote font-semibold',
              TONE[secondary.tone],
            )}
            style={{ width: W, opacity: secondaryOpacity }}
          >
            {SecondaryIcon ? <SecondaryIcon size={20} strokeWidth={1.75} absoluteStrokeWidth /> : null}
            <span>{secondary.label}</span>
          </m.button>
        ) : null}
      </div>
    </m.div>
  );
}
