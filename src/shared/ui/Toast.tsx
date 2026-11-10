import type { LucideIcon } from 'lucide-react';
import {
  AnimatePresence,
  type AnimationPlaybackControls,
  animate,
  m,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from 'motion/react';
import { type PointerEvent as ReactPointerEvent, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  activationThreshold,
  lockAxis,
  presets,
  releaseTransition,
  shouldDismissToast,
  THRESHOLDS,
  toastDragY,
  toastOpacityForY,
  VelocityTracker,
} from '@/shared/lib/motion';
import { cx } from './cx';

export interface ToastData {
  /** A new id replaces the current toast (one at a time). */
  id: string;
  message: string;
  icon?: LucideIcon | undefined;
  action?: { label: string; onPress: () => void } | undefined;
}

export interface ToastProps {
  toast: ToastData | null;
  /** Called when the toast times out, is swiped away or its action runs. */
  onDismiss: (id: string) => void;
  /** Above the floating tab bar (default) or above the bottom inset. */
  placement?: 'tab-bar' | 'bottom' | undefined;
}

/**
 * Transient confirmation with optional undo (04 §7, 02 §3.7): material capsule at the bottom, one at a time, 4 s
 * (6 s with an action, 10 s while focused), paused while touched or hidden; swipe down to dismiss.
 */
export function Toast({ toast, onDismiss, placement = 'tab-bar' }: ToastProps) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className={cx(
        'pointer-events-none fixed inset-x-0 z-(--z-toast) flex justify-center px-4',
        placement === 'tab-bar'
          ? 'bottom-[calc(var(--tab-bar-bottom)+var(--tab-bar-height)+12px)]'
          : 'bottom-[calc(var(--safe-bottom)+12px)]',
      )}
    >
      <AnimatePresence initial={false}>
        {toast ? <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} /> : null}
      </AnimatePresence>
    </div>,
    document.body,
  );
}

interface DragState {
  id: number;
  pointerType: string;
  startX: number;
  startY: number;
  originY: number;
  phase: 'idle' | 'pending' | 'drag';
}

function ToastItem({ toast, onDismiss }: { toast: ToastData; onDismiss: (id: string) => void }) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const y = useMotionValue(0);
  const exitY = useRef(100);
  const opacity = useTransform(y, (v) => toastOpacityForY(v, exitY.current));
  const anim = useRef<AnimationPlaybackControls | null>(null);
  const tracker = useRef(new VelocityTracker());
  const drag = useRef<DragState>({ id: -1, pointerType: 'touch', startX: 0, startY: 0, originY: 0, phase: 'idle' });
  const dismissed = useRef(false);

  const dismiss = () => {
    if (dismissed.current) return;
    dismissed.current = true;
    onDismiss(toast.id);
  };

  // Lifetime with pause / resume.
  const timer = useRef({ remaining: 0, startedAt: 0, handle: undefined as ReturnType<typeof setTimeout> | undefined });
  const paused = useRef({ touch: false, hidden: false, focus: false });
  const schedule = () => {
    const t = timer.current;
    clearTimeout(t.handle);
    const p = paused.current;
    if (p.touch || p.hidden) return;
    t.startedAt = performance.now();
    t.handle = setTimeout(dismiss, t.remaining);
  };
  const pause = () => {
    const t = timer.current;
    if (t.handle === undefined) return;
    clearTimeout(t.handle);
    t.handle = undefined;
    t.remaining = Math.max(0, t.remaining - (performance.now() - t.startedAt));
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: one lifetime per toast id
  useEffect(() => {
    const T = THRESHOLDS.toast;
    timer.current.remaining = toast.action ? T.lifetimeWithActionMs : T.lifetimeMs;
    paused.current.hidden = document.hidden;
    schedule();
    const onVisibility = () => {
      paused.current.hidden = document.hidden;
      if (document.hidden) pause();
      else schedule();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      clearTimeout(timer.current.handle);
    };
  }, [toast.id]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const d = drag.current;
    d.id = e.pointerId;
    d.pointerType = e.pointerType;
    d.startX = e.clientX;
    d.startY = e.clientY;
    d.phase = 'pending';
    paused.current.touch = true;
    pause();
    anim.current?.stop();
    exitY.current = (ref.current?.offsetHeight ?? 60) + THRESHOLDS.overshootBleed;
    tracker.current.reset();
    tracker.current.add(e.clientY, e.timeStamp);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d.id !== e.pointerId || d.phase === 'idle') return;
    tracker.current.add(e.clientY, e.timeStamp);
    if (d.phase === 'pending') {
      const axis = lockAxis(e.clientX - d.startX, e.clientY - d.startY, activationThreshold(d.pointerType));
      if (axis === null) return;
      if (axis === 'x') {
        d.phase = 'idle';
        return;
      }
      d.phase = 'drag';
      d.originY = e.clientY - y.get();
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    y.set(toastDragY(e.clientY - d.originY));
  };

  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const d = drag.current;
    if (d.id !== e.pointerId) return;
    const wasDragging = d.phase === 'drag';
    d.id = -1;
    d.phase = 'idle';
    paused.current.touch = false;
    if (!wasDragging) {
      schedule();
      return;
    }
    const v = cancelled ? 0 : tracker.current.velocity(e.timeStamp);
    if (!cancelled && shouldDismissToast(y.get(), v)) {
      const controls = animate(y, exitY.current, releaseTransition(v, 'smooth', reduced));
      anim.current = controls;
      controls.then(dismiss);
      return;
    }
    anim.current = animate(y, 0, releaseTransition(v, 'smooth', reduced));
    schedule();
  };

  const Icon = toast.icon;
  const enter = reduced ? presets.reduced : presets.smooth;
  const exit = reduced ? presets.reduced : presets.snappy;

  return (
    <m.div
      className="pointer-events-auto w-full max-w-[568px]"
      initial={reduced ? { opacity: 0 } : { y: 24, opacity: 0 }}
      animate={{ y: 0, opacity: 1, transition: enter }}
      exit={reduced ? { opacity: 0, transition: exit } : { y: 12, opacity: 0, transition: exit }}
    >
      <m.div
        ref={ref}
        style={{ y, opacity }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => onPointerEnd(e, false)}
        onPointerCancel={(e) => onPointerEnd(e, true)}
        onFocusCapture={() => {
          if (paused.current.focus) return;
          paused.current.focus = true;
          pause();
          timer.current.remaining = Math.max(timer.current.remaining, THRESHOLDS.toast.lifetimeFocusedMs);
          schedule();
        }}
        className="material flex min-h-[52px] touch-none items-center gap-3 rounded-md border border-edge py-2 pr-2 pl-4 shadow-float select-none"
      >
        {Icon ? (
          <Icon
            size={20}
            strokeWidth={1.5}
            absoluteStrokeWidth
            aria-hidden="true"
            className="shrink-0 text-label-secondary"
          />
        ) : null}
        <p className="min-w-0 flex-1 py-1 type-callout text-label-primary">{toast.message}</p>
        {toast.action ? (
          <button
            type="button"
            onClick={() => {
              toast.action?.onPress();
              dismiss();
            }}
            className="min-h-11 shrink-0 rounded-sm px-3 type-headline text-accent-fg outline-none transition-opacity duration-150 focus-visible:focus-ring active:opacity-60 active:transition-none"
          >
            {toast.action.label}
          </button>
        ) : null}
      </m.div>
    </m.div>
  );
}
