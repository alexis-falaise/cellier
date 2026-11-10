import { type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, useEffect, useRef } from 'react';
import { THRESHOLDS } from '@/shared/lib/motion';

interface HighlightState {
  id: number;
  x: number;
  y: number;
  shown: boolean;
  cancelled: boolean;
  showTimer: ReturnType<typeof setTimeout> | undefined;
  hideTimer: ReturnType<typeof setTimeout> | undefined;
  el: HTMLElement | null;
}

/**
 * Row pressed highlight (02 §1.1 rule 2, §3.4): no scale. In a scroll container the highlight appears after an 80 ms
 * hold without moving 10 px, or on pointer-up for a shorter tap; outside, it appears instantly. It is drawn by CSS from
 * `data-pressed` (instant on, 150 ms off).
 */
export function useRowHighlight(inScrollContainer = true, disabled = false) {
  const s = useRef<HighlightState>({
    id: -1,
    x: 0,
    y: 0,
    shown: false,
    cancelled: false,
    showTimer: undefined,
    hideTimer: undefined,
    el: null,
  });

  useEffect(() => {
    const st = s.current;
    return () => {
      clearTimeout(st.showTimer);
      clearTimeout(st.hideTimer);
    };
  }, []);

  const show = () => {
    const st = s.current;
    if (st.el) st.el.dataset.pressed = '';
    st.shown = true;
  };
  const hide = (afterMs: number) => {
    const st = s.current;
    const el = st.el;
    clearTimeout(st.hideTimer);
    st.hideTimer = setTimeout(() => {
      if (el) delete el.dataset.pressed;
    }, afterMs);
  };
  const end = (cancel: boolean) => {
    const st = s.current;
    if (st.id === -1) return;
    st.id = -1;
    clearTimeout(st.showTimer);
    if (cancel) {
      st.cancelled = true;
      hide(0);
      return;
    }
    if (!st.shown) show();
    hide(THRESHOLDS.press.minVisibleMs);
  };

  return {
    onPointerDown(e: ReactPointerEvent<HTMLElement>) {
      if (disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const st = s.current;
      clearTimeout(st.hideTimer);
      st.id = e.pointerId;
      st.x = e.clientX;
      st.y = e.clientY;
      st.shown = false;
      st.cancelled = false;
      st.el = e.currentTarget;
      if (inScrollContainer) st.showTimer = setTimeout(show, THRESHOLDS.press.scrollHighlightDelayMs);
      else show();
    },
    onPointerMove(e: ReactPointerEvent<HTMLElement>) {
      const st = s.current;
      if (st.id !== e.pointerId) return;
      if (Math.hypot(e.clientX - st.x, e.clientY - st.y) > THRESHOLDS.press.cancelDistance) end(true);
    },
    onPointerUp(e: ReactPointerEvent<HTMLElement>) {
      if (s.current.id === e.pointerId) end(false);
    },
    onPointerCancel(e: ReactPointerEvent<HTMLElement>) {
      if (s.current.id === e.pointerId) end(true);
    },
    onPointerLeave(e: ReactPointerEvent<HTMLElement>) {
      if (e.pointerType === 'mouse' && s.current.id === e.pointerId) end(true);
    },
    onClickCapture(e: ReactMouseEvent<HTMLElement>) {
      if (!s.current.cancelled) return;
      s.current.cancelled = false;
      e.preventDefault();
      e.stopPropagation();
    },
  };
}
