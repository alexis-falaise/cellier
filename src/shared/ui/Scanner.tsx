import { AnimatePresence, animate, m, useMotionValue, useReducedMotion } from 'motion/react';
import { type ReactNode, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { IMPULSE, impulseTransition, presets } from '@/shared/lib/motion';
import { cx } from './cx';
import { useModalFocus } from './hooks/useModalFocus';

export interface ScannerCoverProps {
  open: boolean;
  onClose: () => void;
  /** Rect of the scan button: the cover grows out of its centre and folds back into it. */
  originRect: DOMRect | null;
  /** «Scanner». */
  label: string;
  children: ReactNode;
}

/**
 * Full-screen true-black scanner container (04 §2, 02 §4.1): scale 0.6 → 1 and opacity with `sheet`, origin at the
 * scan button centre; fixed 40 px corners (never animated); covers the tab bar. Escape closes.
 */
export function ScannerCover({ open, onClose, originRect, label, children }: ScannerCoverProps) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <AnimatePresence>
      {open ? (
        <CoverContent key="cover" onClose={onClose} originRect={originRect} label={label}>
          {children}
        </CoverContent>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

function CoverContent({ onClose, originRect, label, children }: Omit<ScannerCoverProps, 'open'>) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  useModalFocus(ref, true, onClose);
  const origin = originRect
    ? `${originRect.left + originRect.width / 2}px ${originRect.top + originRect.height / 2}px`
    : '50% 100%';
  const t = reduced ? presets.reduced : presets.sheet;
  return (
    <m.div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
      className="fixed inset-0 z-(--z-scanner) overflow-hidden rounded-[40px] bg-scanner-bg text-stone-0 outline-none [color-scheme:dark] will-change-transform"
      style={{ transformOrigin: origin }}
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: 1, transition: t }}
      exit={reduced ? { opacity: 0, transition: t } : { opacity: 0, scale: 0.6, transition: t }}
    >
      {children}
    </m.div>
  );
}

export type ReticleTone = 'idle' | 'success' | 'unknown';

export interface ReticleProps {
  /** Incremented on each successful scan: starts a new `pop` impulse from the current value. */
  successCount: number;
  tone: ReticleTone;
  /** Tightens the corners while a code is being read. */
  reading?: boolean | undefined;
  width?: number | undefined;
  height?: number | undefined;
  className?: string | undefined;
}

/**
 * Four rounded corners marking the read region (04 §4): white 70 % idle, accent on success, amber for an unknown
 * product. Success plays a scale impulse (`pop`, velocity −3 /s). Colour changes are CSS (150 ms). No idle loop.
 */
export function Reticle({ successCount, tone, reading = false, width = 260, height = 140, className }: ReticleProps) {
  const reduced = useReducedMotion();
  const scale = useMotionValue(1);
  const tight = useMotionValue(1);
  const last = useRef(successCount);

  useEffect(() => {
    if (successCount === last.current) return;
    last.current = successCount;
    if (reduced) return;
    animate(scale, 1, impulseTransition(scale.getVelocity() + IMPULSE.reticle));
  }, [successCount, reduced, scale]);

  useEffect(() => {
    if (reduced) return;
    animate(tight, reading ? 0.96 : 1, presets.snappy);
  }, [reading, reduced, tight]);

  const colour = tone === 'success' ? 'text-green-400' : tone === 'unknown' ? 'text-amber-300' : 'text-stone-0/70';
  const corner = 'absolute size-7 border-current transition-colors duration-150 ease-out';
  return (
    <m.div aria-hidden="true" className={cx('relative', colour, className)} style={{ width, height, scale }}>
      <m.div className="absolute inset-0" style={{ scale: tight }}>
        <span className={cx(corner, 'top-0 left-0 rounded-tl-[14px] border-t-[3px] border-l-[3px]')} />
        <span className={cx(corner, 'top-0 right-0 rounded-tr-[14px] border-t-[3px] border-r-[3px]')} />
        <span className={cx(corner, 'bottom-0 left-0 rounded-bl-[14px] border-b-[3px] border-l-[3px]')} />
        <span className={cx(corner, 'right-0 bottom-0 rounded-br-[14px] border-r-[3px] border-b-[3px]')} />
      </m.div>
    </m.div>
  );
}
