import { ChevronRight, type LucideIcon } from 'lucide-react';
import { AnimatePresence, m } from 'motion/react';
import { type HTMLInputTypeAttribute, useId } from 'react';
import { usePreset } from '@/shared/lib/motion';
import { cx } from './cx';
import { usePress } from './hooks/usePress';
import { RowSeparator } from './List';

export interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** `inline`: label left, value right in a 52 px row. `stacked`: full-width input (label as section header elsewhere). */
  layout?: 'inline' | 'stacked' | undefined;
  inputMode?: 'text' | 'numeric' | 'decimal' | 'email' | undefined;
  type?: HTMLInputTypeAttribute | undefined;
  placeholder?: string | undefined;
  /** Unit suffix, e.g. «€», «g». */
  unit?: string | undefined;
  /** Inline validation message under the row. */
  error?: string | undefined;
  /** Value overrides the reference data: shows «Modifié» and «Rétablir». */
  override?: { modifiedLabel: string; resetLabel: string; onReset: () => void } | undefined;
  autoComplete?: string | undefined;
  enterKeyHint?: 'done' | 'next' | 'go' | 'search' | 'send' | undefined;
  autoFocus?: boolean | undefined;
  maxLength?: number | undefined;
  /** Separator inset of the row inside a `ListSection`. */
  separatorInset?: number | undefined;
}

/**
 * Field inside an inset grouped row (04 §6): visible label always, value right-aligned (inline) or full width
 * (stacked), unit suffix, error linked with `aria-describedby`, override indicator with reset.
 */
export function TextField({
  label,
  value,
  onChange,
  layout = 'inline',
  inputMode,
  type = 'text',
  placeholder,
  unit,
  error,
  override,
  autoComplete,
  enterKeyHint,
  autoFocus,
  maxLength,
  separatorInset = 16,
}: TextFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const transition = usePreset('snappy');
  const input = (
    <input
      id={id}
      type={type}
      inputMode={inputMode}
      value={value}
      placeholder={placeholder}
      autoComplete={autoComplete}
      enterKeyHint={enterKeyHint}
      maxLength={maxLength}
      data-autofocus={autoFocus ? '' : undefined}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? errorId : undefined}
      onChange={(e) => onChange(e.currentTarget.value)}
      className={cx(
        'min-w-0 flex-1 bg-transparent type-body text-label-primary outline-none placeholder:text-label-tertiary',
        layout === 'inline' ? 'text-right' : 'text-left',
      )}
    />
  );
  return (
    // biome-ignore lint/a11y/useSemanticElements: rows sit inside SwipeActions wrappers, so a native li would not be a direct child of the list
    <div role="listitem">
      {/* Inset ring (text fields show it whenever focused, as on iOS). `row-corners` rounds it like the section's
          clip so it is not cut at the corners; with an error line below, the row's bottom is not the section's. */}
      <div
        className={cx(
          'relative row-corners flex min-h-[52px] items-center gap-3 px-4',
          'focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-focus-ring',
          error && '[--row-radius-bottom:0px]',
        )}
      >
        {layout === 'inline' ? (
          <label htmlFor={id} className="shrink-0 type-body text-label-primary">
            {label}
          </label>
        ) : (
          <label htmlFor={id} className="sr-only">
            {label}
          </label>
        )}
        {input}
        {unit ? <span className="shrink-0 type-body text-label-tertiary">{unit}</span> : null}
        <AnimatePresence initial={false}>
          {override ? (
            <m.span
              className="flex shrink-0 items-center gap-2"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={transition}
            >
              <span className="rounded-xs bg-fill-tertiary px-1.5 py-0.5 type-caption-1 text-label-secondary">
                {override.modifiedLabel}
              </span>
              <button
                type="button"
                onClick={override.onReset}
                className="relative type-subhead text-accent-fg outline-none before:absolute before:-inset-3 focus-visible:focus-ring active:opacity-60"
              >
                {override.resetLabel}
              </button>
            </m.span>
          ) : null}
        </AnimatePresence>
        <RowSeparator inset={separatorInset} />
      </div>
      {error ? (
        <p id={errorId} className="px-4 pb-2 type-footnote text-danger-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface ChipOption<V extends string> {
  value: V;
  label: string;
}

export interface ChipGroupProps<V extends string> {
  options: readonly ChipOption<V>[];
  /** Selected values (single or multiple). */
  selected: readonly V[];
  onToggle: (value: V) => void;
  label: string;
  className?: string | undefined;
}

/** Tappable suggestions (04 §10): selected chips use `accent-tint`. Press scale 0.97. */
export function ChipGroup<V extends string>({ options, selected, onToggle, label, className }: ChipGroupProps<V>) {
  return (
    <fieldset aria-label={label} className={cx('flex min-w-0 flex-wrap gap-2', className)}>
      {options.map((o) => (
        <Chip key={o.value} label={o.label} selected={selected.includes(o.value)} onPress={() => onToggle(o.value)} />
      ))}
    </fieldset>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { scale, handlers } = usePress(0.97);
  return (
    <m.button
      type="button"
      aria-pressed={selected}
      onClick={onPress}
      {...handlers}
      style={{ scale }}
      className={cx(
        'relative min-h-9 rounded-full border border-edge px-3.5 type-subhead outline-none before:absolute before:inset-x-0 before:-inset-y-1',
        'transition-colors duration-150 ease-out focus-visible:focus-ring',
        selected ? 'bg-accent-tint font-semibold text-accent-fg' : 'bg-fill-tertiary text-label-primary',
      )}
    >
      {label}
    </m.button>
  );
}

export interface OptionCardProps {
  icon: LucideIcon;
  title: string;
  subtitle?: string | undefined;
  onPress: () => void;
}

/** 76 px choice row in onboarding (create or join a household), press scale 0.97. */
export function OptionCard({ icon: Icon, title, subtitle, onPress }: OptionCardProps) {
  const { scale, handlers } = usePress(0.97);
  return (
    <m.button
      type="button"
      onClick={onPress}
      {...handlers}
      style={{ scale }}
      className={cx(
        'flex min-h-[76px] w-full items-center gap-3 rounded-lg border border-edge bg-surface px-4 text-left outline-none',
        'focus-visible:focus-ring motion-reduce:data-pressed:bg-fill-quaternary',
      )}
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent-tint text-accent-fg">
        <Icon size={22} strokeWidth={1.75} absoluteStrokeWidth aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="type-headline text-label-primary">{title}</span>
        {subtitle ? <span className="type-subhead text-label-secondary">{subtitle}</span> : null}
      </span>
      <ChevronRight
        size={17}
        strokeWidth={1.5}
        absoluteStrokeWidth
        aria-hidden="true"
        className="text-label-tertiary"
      />
    </m.button>
  );
}
