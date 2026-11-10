import { cx } from './cx';
import { useDelayedVisibility } from './hooks/useDelayedVisibility';

export interface SpinnerProps {
  size?: number | undefined;
  className?: string | undefined;
  /** Accessible label; omit when the spinner is decorative (e.g. inside a labelled button). */
  label?: string | undefined;
}

const SPOKES = [0, 1, 2, 3, 4, 5, 6, 7];

/** Activity indicator: 8 spokes, one revolution per second in 8 steps (02 §4.1). Kept under reduced motion. */
export function Spinner({ size = 20, className, label }: SpinnerProps) {
  return (
    <span
      {...(label ? { role: 'progressbar', 'aria-label': label } : { 'aria-hidden': true })}
      className={cx('inline-flex shrink-0', className)}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 24 24" width={size} height={size} className="animate-spinner" aria-hidden="true">
        {SPOKES.map((i) => (
          <line
            key={i}
            x1="12"
            y1="3"
            x2="12"
            y2="7.5"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            opacity={1 - i * 0.11}
            transform={`rotate(${-i * 45} 12 12)`}
          />
        ))}
      </svg>
    </span>
  );
}

export interface DelayedSpinnerProps extends SpinnerProps {
  active: boolean;
}

/** Spinner with the 300 ms show delay and 500 ms minimum visible time of 02 §4.1. */
export function DelayedSpinner({ active, ...rest }: DelayedSpinnerProps) {
  const visible = useDelayedVisibility(active);
  return visible ? <Spinner {...rest} /> : null;
}

export interface PullSpinnerProps {
  /** Pull progress 0..1; all spokes lit and turning at 1. */
  progress: number;
  size?: number | undefined;
  className?: string | undefined;
}

/** Pull-to-refresh spinner: spokes fill with the pull distance, then turn (02 §3.8). */
export function PullSpinner({ progress, size = 20, className }: PullSpinnerProps) {
  const lit = Math.round(Math.max(0, Math.min(1, progress)) * 8);
  return (
    <span aria-hidden="true" className={cx('inline-flex text-label-secondary', className)}>
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        className={lit >= 8 ? 'animate-spinner' : undefined}
        aria-hidden="true"
      >
        {SPOKES.map((i) => (
          <line
            key={i}
            x1="12"
            y1="3"
            x2="12"
            y2="7.5"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            opacity={i < lit ? 1 - i * 0.08 : 0}
            transform={`rotate(${i * 45} 12 12)`}
          />
        ))}
      </svg>
    </span>
  );
}
