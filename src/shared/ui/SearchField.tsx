import { CircleX, Search } from 'lucide-react';
import { m } from 'motion/react';
import { type Ref, useRef, useState } from 'react';
import { usePreset } from '@/shared/lib/motion';
import { cx } from './cx';

export interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Also the field's accessible name, e.g. «Rechercher dans le stock». */
  placeholder: string;
  /** «Annuler»: shown while focused; clears and blurs. */
  cancelLabel: string;
  /** «Effacer». */
  clearLabel: string;
  onCancel?: (() => void) | undefined;
  onSubmit?: ((value: string) => void) | undefined;
  onFocusChange?: ((focused: boolean) => void) | undefined;
  /** Variant for dark surfaces (scanner). */
  className?: string | undefined;
  ref?: Ref<HTMLInputElement> | undefined;
}

/**
 * Search field (04 §3): 36 px, radius 10, `fill-tertiary`, leading `search`, clear button when filled, «Annuler» to the
 * right while focused. Nothing animates on typing; the field width changes on frame 0 and «Annuler» fades in (`snappy`).
 */
export function SearchField({
  value,
  onChange,
  placeholder,
  cancelLabel,
  clearLabel,
  onCancel,
  onSubmit,
  onFocusChange,
  className,
  ref,
}: SearchFieldProps) {
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const transition = usePreset('snappy');
  const setRefs = (el: HTMLInputElement | null) => {
    inputRef.current = el;
    if (typeof ref === 'function') ref(el);
    else if (ref) ref.current = el;
  };
  return (
    <search className={className}>
      <form
        className="flex items-center gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          inputRef.current?.blur();
          onSubmit?.(value);
        }}
      >
        <div className="relative flex h-9 min-w-0 flex-1 items-center rounded-sm border border-edge bg-fill-tertiary">
          <Search
            size={17}
            strokeWidth={1.5}
            absoluteStrokeWidth
            aria-hidden="true"
            className="pointer-events-none absolute left-2 text-label-tertiary"
          />
          <input
            ref={setRefs}
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label={placeholder}
            placeholder={placeholder}
            value={value}
            onChange={(e) => onChange(e.currentTarget.value)}
            onFocus={() => {
              setFocused(true);
              onFocusChange?.(true);
            }}
            onBlur={() => {
              setFocused(false);
              onFocusChange?.(false);
            }}
            className={cx(
              'h-full w-full min-w-0 appearance-none bg-transparent pr-9 pl-8 text-[max(16px,var(--text-subhead))] text-label-primary outline-none',
              'placeholder:text-label-tertiary [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden',
            )}
          />
          {value ? (
            <button
              type="button"
              aria-label={clearLabel}
              onClick={() => {
                onChange('');
                inputRef.current?.focus();
              }}
              className="absolute right-0 flex size-11 items-center justify-center text-label-tertiary outline-none focus-visible:focus-ring"
            >
              <CircleX size={17} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" />
            </button>
          ) : null}
        </div>
        {focused ? (
          <m.button
            type="button"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={transition}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => {
              onChange('');
              inputRef.current?.blur();
              onCancel?.();
            }}
            className="min-h-11 shrink-0 type-body text-accent-fg outline-none focus-visible:focus-ring"
          >
            {cancelLabel}
          </m.button>
        ) : null}
      </form>
    </search>
  );
}
