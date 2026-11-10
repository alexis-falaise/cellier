import { type LucideIcon, Minus, Plus } from 'lucide-react';
import { m } from 'motion/react';
import { type KeyboardEvent, type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';
import { clamp, repeatInterval } from '@/shared/lib/motion';
import { cx } from './cx';
import { usePress } from './hooks/usePress';
import { QuantityNumber } from './QuantityNumber';

export interface QuantityStepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number | undefined;
  max?: number | undefined;
  step?: number | undefined;
  size?: 'regular' | 'large' | undefined;
  /** «Quantité». */
  label: string;
  /** «Retirer 1». */
  decrementLabel: string;
  /** «Ajouter 1». */
  incrementLabel: string;
  /** Label of the inline numeric entry, e.g. «Saisir la quantité». */
  editLabel: string;
  unit?: string | undefined;
  /** Dark variant for the scanner tray. */
  onDark?: boolean | undefined;
  className?: string | undefined;
}

/**
 * Minus · number · plus (04 §3): 44 × 44 buttons with a 32 px visible circle, hold to repeat after 400 ms with
 * acceleration (cap 10 steps/s), tap the number for a numeric entry. No haptic per step. `role="spinbutton"`.
 */
export function QuantityStepper({
  value,
  onChange,
  min = 0,
  max = 9999,
  step = 1,
  size = 'regular',
  label,
  decrementLabel,
  incrementLabel,
  editLabel,
  unit,
  onDark = false,
  className,
}: QuantityStepperProps) {
  const latest = useRef({ value, onChange, min, max, step });
  useEffect(() => {
    latest.current = { value, onChange, min, max, step };
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const bump = (dir: 1 | -1) => {
    const l = latest.current;
    const next = clamp(l.value + dir * l.step, l.min, l.max);
    if (next !== l.value) {
      l.value = next;
      l.onChange(next);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (editing) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault();
      bump(1);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault();
      bump(-1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      onChange(min);
    } else if (e.key === 'End' && max !== 9999) {
      e.preventDefault();
      onChange(max);
    }
  };

  const commitDraft = () => {
    const parsed = Number.parseInt(draft, 10);
    if (Number.isFinite(parsed)) onChange(clamp(parsed, min, max));
    setEditing(false);
  };

  const large = size === 'large';
  return (
    <div
      role="spinbutton"
      tabIndex={0}
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuetext={unit ? `${value} ${unit}` : String(value)}
      onKeyDown={onKeyDown}
      className={cx('inline-flex items-center gap-1 rounded-md outline-none focus-visible:focus-ring', className)}
    >
      <StepperButton
        icon={Minus}
        label={decrementLabel}
        disabled={value <= min}
        onStep={() => bump(-1)}
        onDark={onDark}
      />
      {editing ? (
        <input
          // biome-ignore lint/a11y/noAutofocus: the field replaces the number the user just tapped
          autoFocus
          aria-label={editLabel}
          inputMode="numeric"
          pattern="[0-9]*"
          enterKeyHint="done"
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value.replace(/\D/g, ''))}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitDraft();
            if (e.key === 'Escape') setEditing(false);
          }}
          className={cx(
            'w-[4ch] min-w-11 rounded-sm bg-fill-tertiary text-center outline-none focus-visible:focus-ring',
            large ? 'type-quantity-xl' : 'type-quantity',
          )}
        />
      ) : (
        <button
          type="button"
          tabIndex={-1}
          aria-label={editLabel}
          onClick={() => {
            setDraft(String(value));
            setEditing(true);
          }}
          className={cx(
            'flex min-h-11 items-center justify-center rounded-sm px-1 outline-none',
            onDark && 'text-stone-0',
          )}
        >
          <QuantityNumber value={value} size={large ? 'stepper-large' : 'stepper'} unit={unit} live />
        </button>
      )}
      <StepperButton
        icon={Plus}
        label={incrementLabel}
        disabled={value >= max}
        onStep={() => bump(1)}
        onDark={onDark}
      />
    </div>
  );
}

interface StepperButtonProps {
  icon: LucideIcon;
  label: string;
  disabled: boolean;
  onStep: () => void;
  onDark: boolean;
}

function StepperButton({ icon: Icon, label, disabled, onStep, onDark }: StepperButtonProps) {
  const { scale, handlers } = usePress(0.92, disabled);
  const hold = useRef<{ timer: ReturnType<typeof setTimeout> | undefined; start: number; repeated: boolean }>({
    timer: undefined,
    start: 0,
    repeated: false,
  });
  useEffect(() => {
    const h = hold.current;
    return () => clearTimeout(h.timer);
  }, []);

  const stop = () => clearTimeout(hold.current.timer);
  const tick = () => {
    const h = hold.current;
    const interval = repeatInterval(performance.now() - h.start);
    if (interval === null) return;
    h.repeated = true;
    onStep();
    h.timer = setTimeout(tick, interval);
  };

  return (
    <m.button
      type="button"
      tabIndex={-1}
      aria-label={label}
      disabled={disabled}
      style={{ scale }}
      {...handlers}
      onPointerDown={(e: ReactPointerEvent<HTMLElement>) => {
        handlers.onPointerDown(e);
        if (disabled) return;
        const h = hold.current;
        h.start = performance.now();
        h.repeated = false;
        stop();
        h.timer = setTimeout(tick, 400);
      }}
      onPointerUp={(e: ReactPointerEvent<HTMLElement>) => {
        handlers.onPointerUp(e);
        stop();
      }}
      onPointerCancel={(e: ReactPointerEvent<HTMLElement>) => {
        handlers.onPointerCancel(e);
        stop();
      }}
      onPointerLeave={(e: ReactPointerEvent<HTMLElement>) => {
        handlers.onPointerLeave(e);
        if (e.pointerType === 'mouse') stop();
      }}
      onClick={() => {
        if (hold.current.repeated) {
          hold.current.repeated = false;
          return;
        }
        onStep();
      }}
      className={cx(
        'group relative flex size-11 shrink-0 touch-manipulation items-center justify-center rounded-full outline-none',
        'disabled:opacity-40',
        onDark ? 'text-stone-0' : 'text-accent-fg',
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          'absolute size-8 rounded-full border border-edge',
          onDark ? 'bg-stone-0/15' : 'bg-fill-secondary',
        )}
      />
      <Icon
        size={17}
        strokeWidth={2}
        absoluteStrokeWidth
        aria-hidden="true"
        className="relative transition-opacity duration-150 motion-reduce:group-data-pressed:opacity-60 motion-reduce:group-data-pressed:transition-none"
      />
    </m.button>
  );
}
