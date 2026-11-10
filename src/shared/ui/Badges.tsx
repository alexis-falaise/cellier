import { AnimatePresence, m } from 'motion/react';
import type { ReactNode } from 'react';
import { usePreset } from '@/shared/lib/motion';
import { cx } from './cx';

export interface ForecastBadgeProps {
  /** Display text, e.g. «≈ 4 j», «≈ 2 sem.», «Épuisé», «Seuil». */
  label: string;
  /** Spoken text, e.g. «Environ 4 jours de stock». */
  accessibleLabel?: string | undefined;
  tone?: 'warning' | 'neutral' | undefined;
  className?: string | undefined;
}

/** Days-of-cover capsule (03 §3.4): 24 px high, rounded semibold tabular, amber tint. */
export function ForecastBadge({ label, accessibleLabel, tone = 'warning', className }: ForecastBadgeProps) {
  return (
    <span
      {...(accessibleLabel ? { role: 'img', 'aria-label': accessibleLabel } : {})}
      className={cx(
        'inline-flex h-6 shrink-0 items-center rounded-full px-2 type-badge whitespace-nowrap',
        tone === 'warning' ? 'bg-warning-tint text-warning-fg' : 'bg-fill-tertiary text-label-secondary',
        className,
      )}
    >
      {label}
    </span>
  );
}

export interface CountBadgeProps {
  /** e.g. «× 3». */
  children: ReactNode;
  tone?: 'neutral' | 'accent' | undefined;
  size?: 'regular' | 'small' | undefined;
  className?: string | undefined;
}

/** Suggested quantity / count pill (01 §4.3): `badge` on `fill-tertiary`, radius 6. */
export function CountBadge({ children, tone = 'neutral', size = 'regular', className }: CountBadgeProps) {
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-xs whitespace-nowrap',
        size === 'regular' ? 'min-h-6 min-w-6 px-1.5 py-0.5 type-badge' : 'min-h-[18px] min-w-[18px] px-1 type-badge-s',
        tone === 'accent' ? 'bg-accent text-on-accent' : 'bg-fill-tertiary text-label-secondary',
        className,
      )}
    >
      {children}
    </span>
  );
}

export interface RunningLowMarkerProps {
  visible?: boolean | undefined;
  className?: string | undefined;
}

/**
 * Amber 6 px dot before a quantity (03 §3.3). Decorative: the row's accessible name carries «bientôt épuisé».
 * Appears with `smooth` (scale 0.6 → 1, opacity) when an item becomes low while visible.
 */
export function RunningLowMarker({ visible = true, className }: RunningLowMarkerProps) {
  const transition = usePreset('smooth');
  return (
    <AnimatePresence initial={false}>
      {visible ? (
        <m.span
          aria-hidden="true"
          className={cx('inline-block size-1.5 shrink-0 rounded-full bg-warning-fg', className)}
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.6, opacity: 0 }}
          transition={transition}
        />
      ) : null}
    </AnimatePresence>
  );
}

/** Per-row marker for a change still unsent after 30 s (04 §7): 6 px hollow circle, tertiary. */
export function SyncDot({ label, className }: { label?: string; className?: string }) {
  return (
    <span
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      className={cx('inline-block size-1.5 shrink-0 rounded-full border border-label-tertiary', className)}
    />
  );
}
