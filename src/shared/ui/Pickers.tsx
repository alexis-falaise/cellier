import { Check } from 'lucide-react';
import { m } from 'motion/react';
import type { KeyboardEvent } from 'react';
import { usePreset } from '@/shared/lib/motion';
import { CategoryTile } from './CategoryTile';
import {
  CATEGORY_HUES,
  CATEGORY_ICONS,
  type CategoryHue,
  type CategoryIconName,
  type CategoryVisual,
  hueStyle,
} from './categories';
import { cx } from './cx';

function rovingKeys(e: KeyboardEvent<HTMLElement>, columns: number) {
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]'));
  const index = items.indexOf(document.activeElement as HTMLElement);
  if (index < 0) return;
  const delta =
    e.key === 'ArrowRight'
      ? 1
      : e.key === 'ArrowLeft'
        ? -1
        : e.key === 'ArrowDown'
          ? columns
          : e.key === 'ArrowUp'
            ? -columns
            : 0;
  if (delta === 0) return;
  e.preventDefault();
  const next = items[Math.max(0, Math.min(items.length - 1, index + delta))];
  next?.focus();
  next?.click();
}

function SelectionRing({ visible, className }: { visible: boolean; className?: string }) {
  const transition = usePreset('snappy');
  return (
    <m.span
      aria-hidden="true"
      initial={false}
      animate={{ opacity: visible ? 1 : 0, scale: visible ? 1 : 0.92 }}
      transition={transition}
      className={cx('pointer-events-none absolute rounded-[inherit] border-2 border-accent', className)}
    />
  );
}

export interface CategoryOption {
  id: string;
  name: string;
  visual: CategoryVisual;
}

export interface CategoryPickerProps {
  categories: readonly CategoryOption[];
  value: string | null;
  onChange: (id: string) => void;
  label: string;
}

/** Grid of 56 px category tiles with names, 4 columns; the current one is ringed in accent (04 §6). */
export function CategoryPicker({ categories, value, onChange, label }: CategoryPickerProps) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={(e) => rovingKeys(e, 4)}
      className="grid grid-cols-4 gap-x-2 gap-y-4 px-4"
    >
      {categories.map((c) => {
        const selected = c.id === value;
        return (
          // biome-ignore lint/a11y/useSemanticElements: a styled button with the radio pattern and roving focus
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected || (value === null && c === categories[0]) ? 0 : -1}
            onClick={() => onChange(c.id)}
            className="group flex min-w-0 flex-col items-center gap-1.5 rounded-sm outline-none focus-visible:focus-ring"
          >
            <span className="relative rounded-[16px]">
              <CategoryTile visual={c.visual} size={56} />
              <SelectionRing visible={selected} className="-inset-[4px] rounded-[20px]" />
            </span>
            <span
              className={cx(
                'line-clamp-2 w-full text-center type-caption-1',
                selected ? 'font-semibold text-label-primary' : 'text-label-secondary',
              )}
            >
              {c.name}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export interface IconPickerProps {
  value: CategoryIconName;
  onChange: (icon: CategoryIconName) => void;
  /** Icons to show (e.g. filtered by a search); the curated set by default. */
  icons?: readonly CategoryIconName[] | undefined;
  hue: CategoryHue;
  label: string;
}

/** 6 columns of 44 px cells from the curated set; the selected cell has a 2 px accent ring (03 §4.13.2). */
export function IconPicker({ value, onChange, icons, hue, label }: IconPickerProps) {
  const list = icons ?? (Object.keys(CATEGORY_ICONS) as CategoryIconName[]);
  const { tile, fg } = hueStyle(hue);
  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={(e) => rovingKeys(e, 6)}
      className="grid grid-cols-6 justify-items-center gap-2 px-4"
    >
      {list.map((name) => {
        const { icon: Icon, label: iconLabel } = CATEGORY_ICONS[name];
        const selected = name === value;
        return (
          // biome-ignore lint/a11y/useSemanticElements: a styled button with the radio pattern and roving focus
          <button
            key={name}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={iconLabel}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(name)}
            className="relative flex size-11 items-center justify-center rounded-sm outline-none focus-visible:focus-ring"
            style={selected ? { backgroundColor: tile, color: fg } : undefined}
          >
            <Icon
              size={20}
              strokeWidth={1.5}
              absoluteStrokeWidth
              aria-hidden="true"
              className={selected ? undefined : 'text-label-secondary'}
            />
            <SelectionRing visible={selected} className="inset-0 rounded-sm" />
          </button>
        );
      })}
    </div>
  );
}

export interface ColorSwatchPickerProps {
  value: CategoryHue;
  onChange: (hue: CategoryHue) => void;
  /** French names of the hues, read by VoiceOver. */
  hueLabels: Record<CategoryHue, string>;
  label: string;
}

/** One row of the 12 category hues as 32 px circles (44 px hit); the selected one shows a check (03 §4.13.2). */
export function ColorSwatchPicker({ value, onChange, hueLabels, label }: ColorSwatchPickerProps) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={(e) => rovingKeys(e, 6)}
      className="grid grid-cols-6 justify-items-center gap-y-1 px-4"
    >
      {CATEGORY_HUES.map((hue) => {
        const selected = hue === value;
        const { tile, fg } = hueStyle(hue);
        return (
          // biome-ignore lint/a11y/useSemanticElements: a styled button with the radio pattern and roving focus
          <button
            key={hue}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={hueLabels[hue]}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(hue)}
            className="flex size-11 shrink-0 items-center justify-center rounded-full outline-none focus-visible:focus-ring"
          >
            <span
              aria-hidden="true"
              className="flex size-7 items-center justify-center rounded-full"
              style={{
                backgroundColor: tile,
                color: fg,
                boxShadow: selected
                  ? `inset 0 0 0 1.5px ${fg}, 0 0 0 2px var(--surface), 0 0 0 4px ${fg}`
                  : `inset 0 0 0 1.5px ${fg}`,
              }}
            >
              {selected ? <Check size={14} strokeWidth={2.25} absoluteStrokeWidth /> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
