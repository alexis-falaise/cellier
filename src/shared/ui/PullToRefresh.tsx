import { type MotionValue, m, useMotionValue, useMotionValueEvent, useTransform } from 'motion/react';
import { type RefObject, useEffect, useRef, useState } from 'react';
import { PullSpinner } from './Spinner';

const THRESHOLD = 64;

export interface PullToRefreshOptions {
  onRefresh: () => void;
  disabled?: boolean | undefined;
}

/**
 * Pull to refresh on WebKit's native rubber band (02 §3.8): reads the negative `scrollTop` of the scroll container
 * during the bounce, never moves the content. Arms at −64 px while the finger is down; fires at `touchend`.
 * If the platform never reports a negative scrollTop, nothing happens (the documented fallback).
 */
export function usePullToRefresh(
  scrollRef: RefObject<HTMLElement | null>,
  { onRefresh, disabled }: PullToRefreshOptions,
) {
  const pull = useMotionValue(0);
  const state = useRef({ touching: false, armed: false });
  const latest = useRef(onRefresh);
  useEffect(() => {
    latest.current = onRefresh;
  });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || disabled) return;
    const onScroll = () => {
      const distance = Math.max(0, -el.scrollTop);
      pull.set(distance);
      if (state.current.touching && distance >= THRESHOLD) state.current.armed = true;
    };
    const onTouchStart = () => {
      state.current.touching = true;
      state.current.armed = false;
    };
    const onTouchEnd = () => {
      state.current.touching = false;
      if (state.current.armed) {
        state.current.armed = false;
        latest.current();
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [scrollRef, disabled, pull]);

  return pull;
}

/** The 20 px spinner in the gap above the first row; spokes fill with the pull, then it turns. */
export function PullToRefreshIndicator({ pull }: { pull: MotionValue<number> }) {
  const [progress, setProgress] = useState(0);
  useMotionValueEvent(pull, 'change', (v) => {
    const p = Math.min(1, v / THRESHOLD);
    if (Math.abs(p - progress) >= 1 / 8 || p === 0 || p === 1) setProgress(p);
  });
  const opacity = useTransform(pull, [0, 8], [0, 1]);
  const y = useTransform(pull, (v) => -v / 2 - 10);
  return (
    <m.div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 flex justify-center"
      style={{ opacity, y }}
    >
      <PullSpinner progress={progress} />
    </m.div>
  );
}
