import { animate, m, useMotionValue, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { IMPULSE, impulseTransition, presets } from '@/shared/lib/motion';
import { cx } from './cx';

export type QuantitySize = 'row' | 'stepper' | 'stepper-large' | 'detail' | 'badge';

export interface QuantityNumberProps {
  value: number;
  /** Unit shown after the number in `footnote` tertiary (omit for «pièce»). */
  unit?: string | undefined;
  size?: QuantitySize | undefined;
  /** Formatted text for the value (Intl); defaults to the integer. */
  format?: ((value: number) => string) | undefined;
  /** Tertiary colour, e.g. for a stock of 0. */
  muted?: boolean | undefined;
  /** Polite live region (only inside the stepper, 04 §3). */
  live?: boolean | undefined;
  className?: string | undefined;
}

const SIZE: Record<QuantitySize, string> = {
  row: 'type-quantity',
  stepper: 'type-quantity',
  'stepper-large': 'type-quantity-xl',
  detail: 'type-quantity-l',
  badge: 'type-badge',
};

const ROLL_DISTANCE = 14;

/**
 * A quantity in rounded tabular numerals. Rows and badges play the number impulse (`pop`, 02 §4.1); steppers roll the
 * digits up for an increment and down for a decrement. Reduced motion: instant change.
 */
export function QuantityNumber({
  value,
  unit,
  size = 'row',
  format,
  muted = false,
  live = false,
  className,
}: QuantityNumberProps) {
  const reduced = useReducedMotion();
  const text = format ? format(value) : String(value);
  const roll = size === 'stepper' || size === 'stepper-large';

  const scale = useMotionValue(1);
  const previous = useRef(value);
  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    if (roll || reduced) return;
    const v = Math.min(scale.getVelocity() + IMPULSE.quantity, IMPULSE.quantityCap);
    animate(scale, 1, impulseTransition(v));
  }, [value, roll, reduced, scale]);

  const [rollState, setRollState] = useState({ value, text, prevText: null as string | null, dir: 1, n: 0 });
  if (roll && rollState.value !== value) {
    setRollState({
      value,
      text,
      prevText: rollState.text,
      dir: value > rollState.value ? 1 : -1,
      n: rollState.n + 1,
    });
  }

  const numberClass = cx(SIZE[size], muted ? 'text-label-tertiary' : 'text-label-primary');

  if (roll) {
    const animateRoll = !reduced && rollState.prevText !== null;
    const minCh = Math.max(3, text.length);
    return (
      <span
        className={cx('relative inline-flex items-baseline justify-center', numberClass, className)}
        aria-live={live ? 'polite' : undefined}
        aria-atomic={live ? true : undefined}
      >
        <span className="relative inline-flex justify-center overflow-hidden" style={{ minWidth: `${minCh}ch` }}>
          {animateRoll ? (
            <m.span
              key={`out-${rollState.n}`}
              aria-hidden="true"
              className="absolute inset-x-0 text-center"
              initial={{ y: 0, opacity: 1 }}
              animate={{ y: -ROLL_DISTANCE * rollState.dir, opacity: 0 }}
              transition={presets.pop}
            >
              {rollState.prevText}
            </m.span>
          ) : null}
          <m.span
            key={`in-${rollState.n}`}
            className="relative text-center"
            initial={animateRoll ? { y: ROLL_DISTANCE * rollState.dir, opacity: 0 } : false}
            animate={{ y: 0, opacity: 1 }}
            transition={presets.pop}
          >
            {text}
          </m.span>
        </span>
        {unit ? <span className="ml-1 type-footnote text-label-tertiary">{unit}</span> : null}
      </span>
    );
  }

  return (
    <span className={cx('inline-flex items-baseline', className)}>
      <m.span className={cx('inline-block origin-center', numberClass)} style={{ scale }}>
        {text}
      </m.span>
      {unit ? <span className="ml-1 type-footnote text-label-tertiary">{unit}</span> : null}
    </span>
  );
}
