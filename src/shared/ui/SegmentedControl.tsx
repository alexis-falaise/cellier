import type { LucideIcon } from 'lucide-react';
import { animate, m, useMotionValue, useReducedMotion } from 'motion/react';
import { type KeyboardEvent, useEffect, useRef } from 'react';
import { presets } from '@/shared/lib/motion';
import { cx } from './cx';
import { useElementWidth } from './hooks/useElementWidth';

export interface SegmentOption<V extends string> {
  value: V;
  label: string;
  icon?: LucideIcon | undefined;
}

export interface SegmentedControlProps<V extends string> {
  options: readonly SegmentOption<V>[];
  value: V;
  onChange: (value: V) => void;
  /** Accessible name of the radio group, e.g. «Mode». */
  label: string;
  /** `scanner`: dark material track, white thumb. */
  variant?: 'default' | 'scanner' | undefined;
  className?: string | undefined;
}

/**
 * Two to five exclusive options (04 §6): 32 px track on `fill-tertiary`, thumb on `surface` with the thumb shadow.
 * The thumb moves with `snappy` on `x` (equal segments); labels swap colour via CSS. Arrow keys move the selection.
 */
export function SegmentedControl<V extends string>({
  options,
  value,
  onChange,
  label,
  variant = 'default',
  className,
}: SegmentedControlProps<V>) {
  const reduced = useReducedMotion();
  const trackRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(trackRef);
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const segment = options.length > 0 ? width / options.length : 0;
  const x = useMotionValue(0);
  const thumbOpacity = useMotionValue(1);
  const placed = useRef(false);

  useEffect(() => {
    if (segment === 0) return;
    const target = index * segment;
    if (!placed.current) {
      x.set(target);
      placed.current = true;
      return;
    }
    if (reduced) {
      // Cross-fade the thumb between segments.
      thumbOpacity.set(0);
      x.set(target);
      animate(thumbOpacity, 1, presets.reduced);
      return;
    }
    animate(x, target, presets.snappy);
  }, [index, segment, reduced, x, thumbOpacity]);

  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const delta =
      e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (delta === 0) return;
    e.preventDefault();
    const next = (index + delta + options.length) % options.length;
    const option = options[next];
    if (!option) return;
    onChange(option.value);
    buttons.current[next]?.focus();
  };

  const dark = variant === 'scanner';
  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cx(
        'relative flex h-8 rounded-md border border-edge p-0.5',
        dark ? 'bg-scanner-material backdrop-blur-[20px]' : 'bg-fill-tertiary',
        className,
      )}
    >
      <div ref={trackRef} className="relative flex flex-1">
        {segment > 0 ? (
          <m.div
            aria-hidden="true"
            className={cx(
              'absolute inset-y-0 left-0 rounded-[12px] border border-edge',
              dark ? 'bg-stone-0' : 'bg-surface shadow-thumb dark:bg-surface-elevated',
            )}
            style={{ x, width: segment, opacity: thumbOpacity }}
          />
        ) : null}
        {options.map((option, i) => {
          const selected = i === index;
          const Icon = option.icon;
          return (
            // biome-ignore lint/a11y/useSemanticElements: a styled button with the radio pattern and roving focus
            <button
              key={option.value}
              ref={(el) => {
                buttons.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(option.value)}
              className={cx(
                'relative flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[12px] outline-none',
                // Six units (g … pièces) need the narrower inset so «pièces» is not truncated.
                options.length > 4 ? 'px-0.5' : 'px-2',
                'type-subhead transition-colors duration-150 ease-out focus-visible:focus-ring',
                'before:absolute before:inset-x-0 before:-inset-y-1.5',
                selected
                  ? dark
                    ? 'font-semibold text-stone-950'
                    : 'font-semibold text-label-primary'
                  : dark
                    ? 'text-stone-200'
                    : 'text-label-secondary',
              )}
            >
              {Icon ? <Icon size={17} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" /> : null}
              <span className="truncate">{option.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
