import { Minus, ScanBarcode } from 'lucide-react';
import {
  type AnimationPlaybackControls,
  animate,
  m,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from 'motion/react';
import { type MouseEvent, type PointerEvent as ReactPointerEvent, type Ref, useEffect, useRef } from 'react';
import { presets, THRESHOLDS } from '@/shared/lib/motion';
import { cx } from './cx';

export type ScanMode = 'add' | 'withdraw';

export interface ScanButtonProps {
  /** Tap → `add`; long press of 450 ms → `withdraw` (fired when the hold commits). */
  onScan: (mode: ScanMode, origin: DOMRect) => void;
  /**
   * Called on the finger lift that follows a committed long press: the first activation-triggering event, where
   * `getUserMedia` and `video.play()` may be called (02 §3.5).
   */
  onWithdrawRelease?: (() => void) | undefined;
  /** «Scanner des produits». */
  label: string;
  /** «Maintenir pour retirer des produits». */
  hint?: string | undefined;
  className?: string | undefined;
  ref?: Ref<HTMLButtonElement> | undefined;
}

interface HoldState {
  id: number;
  x: number;
  y: number;
  committed: boolean;
  swallowClick: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
  hintTimer: ReturnType<typeof setTimeout> | undefined;
}

const HOLD_SCALE = 0.9 / 0.96;

/**
 * 60 px accent circle detached from the tab bar (04 §1, 02 §3.5). Press scales to 0.96; while held it continues to 0.90
 * linearly over 450 ms and its glyph cross-fades to the withdraw glyph at 300 ms. No haptic.
 */
export function ScanButton({ onScan, onWithdrawRelease, label, hint, className, ref }: ScanButtonProps) {
  const reduced = useReducedMotion();
  const press = useMotionValue(1);
  const hold = useMotionValue(0);
  const scale = useTransform([press, hold], ([p, h]) => (p as number) * (1 - (1 - HOLD_SCALE) * (h as number)));
  const withdrawOpacity = useMotionValue(0);
  const addOpacity = useTransform(withdrawOpacity, (v) => 1 - v);
  const holdAnim = useRef<AnimationPlaybackControls | null>(null);
  const s = useRef<HoldState>({
    id: -1,
    x: 0,
    y: 0,
    committed: false,
    swallowClick: false,
    timer: undefined,
    hintTimer: undefined,
  });

  useEffect(() => {
    const st = s.current;
    return () => {
      clearTimeout(st.timer);
      clearTimeout(st.hintTimer);
    };
  }, []);

  const reset = () => {
    const st = s.current;
    clearTimeout(st.timer);
    clearTimeout(st.hintTimer);
    holdAnim.current?.stop();
    animate(press, 1, presets.press);
    animate(hold, 0, presets.press);
    animate(withdrawOpacity, 0, { duration: THRESHOLDS.longPress.hintFadeMs / 1000 });
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const st = s.current;
    const el = e.currentTarget;
    st.id = e.pointerId;
    st.x = e.clientX;
    st.y = e.clientY;
    st.committed = false;
    st.swallowClick = false;
    el.dataset.pressed = '';
    if (!reduced) {
      animate(press, 0.96, presets.press);
      holdAnim.current = animate(hold, 1, {
        type: 'tween',
        ease: 'linear',
        duration: THRESHOLDS.longPress.durationMs / 1000,
      });
    }
    st.hintTimer = setTimeout(() => {
      animate(withdrawOpacity, 1, { duration: THRESHOLDS.longPress.hintFadeMs / 1000 });
    }, THRESHOLDS.longPress.hintMs);
    st.timer = setTimeout(() => {
      st.committed = true;
      st.swallowClick = true;
      onScan('withdraw', el.getBoundingClientRect());
    }, THRESHOLDS.longPress.durationMs);
  };

  const cancel = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const st = s.current;
    if (st.id !== e.pointerId) return;
    st.id = -1;
    delete e.currentTarget.dataset.pressed;
    if (!st.committed) st.swallowClick = true;
    reset();
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const st = s.current;
    if (st.id !== e.pointerId || st.committed) return;
    if (Math.hypot(e.clientX - st.x, e.clientY - st.y) > THRESHOLDS.press.cancelDistance) cancel(e);
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const st = s.current;
    if (st.id !== e.pointerId) return;
    st.id = -1;
    delete e.currentTarget.dataset.pressed;
    const committed = st.committed;
    reset();
    if (committed) onWithdrawRelease?.();
  };

  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    const st = s.current;
    if (st.swallowClick) {
      st.swallowClick = false;
      e.preventDefault();
      return;
    }
    onScan('add', e.currentTarget.getBoundingClientRect());
  };

  return (
    <m.button
      ref={ref}
      type="button"
      aria-label={label}
      aria-description={hint}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={cancel}
      onContextMenu={(e) => e.preventDefault()}
      onClick={onClick}
      style={{ scale }}
      className={cx(
        'relative inline-flex size-[60px] shrink-0 touch-manipulation select-none items-center justify-center rounded-full',
        'border border-edge bg-accent text-on-accent shadow-accent outline-none focus-visible:focus-ring',
        'transition-[background-color] duration-150 ease-out motion-reduce:data-pressed:bg-accent-pressed motion-reduce:data-pressed:transition-none',
        className,
      )}
    >
      <m.span
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-center"
        style={{ opacity: addOpacity }}
      >
        <ScanBarcode size={28} strokeWidth={2} absoluteStrokeWidth />
      </m.span>
      <m.span
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-center"
        style={{ opacity: withdrawOpacity }}
      >
        <ScanBarcode size={28} strokeWidth={2} absoluteStrokeWidth />
        <span className="absolute top-[13px] right-[11px] flex size-4 items-center justify-center rounded-full bg-on-accent text-accent">
          <Minus size={12} strokeWidth={2.5} absoluteStrokeWidth />
        </span>
      </m.span>
    </m.button>
  );
}
