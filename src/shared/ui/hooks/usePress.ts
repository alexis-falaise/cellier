import { animate, type MotionValue, useMotionValue, useReducedMotion } from 'motion/react';
import { type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, useEffect, useRef } from 'react';
import { presets, THRESHOLDS } from '@/shared/lib/motion';

export interface PressHandlers {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerLeave: (e: ReactPointerEvent<HTMLElement>) => void;
  onClickCapture: (e: ReactMouseEvent<HTMLElement>) => void;
}

interface PressState {
  id: number;
  x: number;
  y: number;
  t: number;
  cancelled: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
  el: HTMLElement | null;
}

/**
 * Press feedback on pointer-down (02 §1.1, §3.4): scale with `press`, 80 ms minimum visible press, cancel by moving
 * 10 px or on pointercancel (the following click is swallowed). Sets `data-pressed` on the element so CSS can draw the
 * reduced-motion colour feedback without a React render.
 */
export function usePress(
  pressedScale: number,
  disabled = false,
): { scale: MotionValue<number>; handlers: PressHandlers } {
  const scale = useMotionValue(1);
  const reduced = useReducedMotion();
  const s = useRef<PressState>({ id: -1, x: 0, y: 0, t: 0, cancelled: false, timer: undefined, el: null });

  useEffect(() => {
    const st = s.current;
    return () => clearTimeout(st.timer);
  }, []);

  const release = (immediate: boolean) => {
    const st = s.current;
    if (st.id === -1) return;
    st.id = -1;
    const elapsed = performance.now() - st.t;
    const delay = immediate ? 0 : Math.max(0, THRESHOLDS.press.minVisibleMs - elapsed);
    const el = st.el;
    clearTimeout(st.timer);
    st.timer = setTimeout(() => {
      if (el) delete el.dataset.pressed;
      animate(scale, 1, presets.press);
    }, delay);
  };

  const handlers: PressHandlers = {
    onPointerDown(e) {
      if (disabled) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const st = s.current;
      clearTimeout(st.timer);
      st.id = e.pointerId;
      st.x = e.clientX;
      st.y = e.clientY;
      st.t = performance.now();
      st.cancelled = false;
      st.el = e.currentTarget;
      e.currentTarget.dataset.pressed = '';
      if (!reduced) animate(scale, pressedScale, presets.press);
    },
    onPointerMove(e) {
      const st = s.current;
      if (st.id !== e.pointerId) return;
      if (Math.hypot(e.clientX - st.x, e.clientY - st.y) > THRESHOLDS.press.cancelDistance) {
        st.cancelled = true;
        release(true);
      }
    },
    onPointerUp(e) {
      if (s.current.id === e.pointerId) release(false);
    },
    onPointerCancel(e) {
      if (s.current.id !== e.pointerId) return;
      s.current.cancelled = true;
      release(true);
    },
    onPointerLeave(e) {
      if (e.pointerType !== 'mouse' || s.current.id !== e.pointerId) return;
      s.current.cancelled = true;
      release(true);
    },
    onClickCapture(e) {
      if (!s.current.cancelled) return;
      s.current.cancelled = false;
      e.preventDefault();
      e.stopPropagation();
    },
  };

  return { scale, handlers };
}
