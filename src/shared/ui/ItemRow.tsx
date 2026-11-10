import { Check } from 'lucide-react';
import { m } from 'motion/react';
import type { ReactNode } from 'react';
import { usePreset } from '@/shared/lib/motion';
import { RunningLowMarker, SyncDot } from './Badges';
import { CategoryTile } from './CategoryTile';
import type { CategoryVisual } from './categories';
import { cx } from './cx';
import { useRowHighlight } from './hooks/useRowHighlight';
import { RowSeparator } from './List';
import { QuantityNumber } from './QuantityNumber';

export interface ItemRowProps {
  name: string;
  /** «{brand} · {size}», «Reste {qty}», «À compléter»… */
  secondary?: ReactNode | undefined;
  visual: CategoryVisual;
  quantity: number;
  /** Omit for «pièce». */
  unit?: string | undefined;
  formatQuantity?: ((value: number) => string) | undefined;
  /** At or below the minimum, or forecast to run out soon: amber marker. */
  low?: boolean | undefined;
  /** `low` shows `trailing` (a `ForecastBadge`) instead of the quantity; `compact` has no tile (search results). */
  variant?: 'stock' | 'low' | 'compact' | undefined;
  trailing?: ReactNode | undefined;
  /** A change older than 30 s still unsent. */
  pending?: boolean | undefined;
  /** Whole-row accessible name, «{nom}, {marque}, {taille}, {quantité} en stock[, bientôt épuisé]». */
  accessibleLabel: string;
  onPress?: (() => void) | undefined;
  inScrollContainer?: boolean | undefined;
}

/**
 * One product in a list (03 §3.3, 04 §3): 36 px category tile, Body name over a Subhead secondary line, trailing
 * rounded tabular quantity with the running-low dot. Highlight on press, no scale; quantity changes pop.
 */
export function ItemRow({
  name,
  secondary,
  visual,
  quantity,
  unit,
  formatQuantity,
  low = false,
  variant = 'stock',
  trailing,
  pending = false,
  accessibleLabel,
  onPress,
  inScrollContainer = true,
}: ItemRowProps) {
  const highlight = useRowHighlight(inScrollContainer, !onPress);
  const compact = variant === 'compact';
  return (
    // biome-ignore lint/a11y/useSemanticElements: rows sit inside SwipeActions wrappers, so a native li would not be a direct child of the list
    <div role="listitem">
      <button
        type="button"
        aria-label={accessibleLabel}
        onClick={onPress}
        {...highlight}
        className={cx(
          'relative flex w-full items-center gap-3 px-4 text-left',
          compact ? 'min-h-[52px] py-2' : 'min-h-[60px] py-3',
          'transition-[background-color] duration-150 ease-out data-pressed:bg-fill-quaternary data-pressed:transition-none',
          'outline-none focus-visible:focus-ring focus-visible:-outline-offset-2',
        )}
      >
        {compact ? null : <CategoryTile visual={visual} size={36} />}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate type-body text-label-primary">{name}</span>
          {secondary ? <span className="truncate type-subhead text-label-secondary">{secondary}</span> : null}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {pending ? <SyncDot /> : null}
          {variant === 'low' && trailing ? (
            trailing
          ) : (
            <>
              <RunningLowMarker visible={low} />
              <span className="flex min-w-8 justify-end">
                <QuantityNumber
                  value={quantity}
                  unit={unit}
                  format={formatQuantity}
                  muted={quantity === 0}
                  size="row"
                />
              </span>
            </>
          )}
        </span>
        <RowSeparator inset={compact ? 16 : 64} />
      </button>
    </div>
  );
}

export interface CheckCircleProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Includes the quantity, e.g. «Lait demi-écrémé, 3». */
  label: string;
}

/** 22 px check circle with a 44 px hit area (01 §4.3); the check appears with `snappy`. */
export function CheckCircle({ checked, onCheckedChange, label }: CheckCircleProps) {
  const transition = usePreset('snappy');
  return (
    // biome-ignore lint/a11y/useSemanticElements: a 44 px custom check circle following the checkbox pattern
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onCheckedChange(!checked)}
      className="relative flex size-11 shrink-0 items-center justify-center rounded-full outline-none focus-visible:focus-ring"
    >
      <span
        aria-hidden="true"
        className={cx(
          'flex size-[22px] items-center justify-center rounded-full border-[1.5px] transition-colors duration-150 ease-out',
          checked ? 'border-accent bg-accent text-on-accent' : 'border-label-quaternary bg-transparent',
        )}
      >
        <m.span
          initial={false}
          animate={checked ? { scale: 1, opacity: 1 } : { scale: 0.5, opacity: 0 }}
          transition={transition}
          className="flex"
        >
          <Check size={14} strokeWidth={2.5} absoluteStrokeWidth />
        </m.span>
      </span>
    </button>
  );
}

export interface GroceryRowProps {
  name: string;
  /** «Sous le minimum», «Épuisé vers le 18 nov.». */
  reason?: string | undefined;
  visual: CategoryVisual;
  /** «× 3». */
  quantityLabel?: string | undefined;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Checkbox label, including the quantity. */
  checkLabel: string;
  onPress?: (() => void) | undefined;
}

/** One suggested item in Courses (04 §5): check circle · tile · name and reason · quantity badge; checked rows dim. */
export function GroceryRow({
  name,
  reason,
  visual,
  quantityLabel,
  checked,
  onCheckedChange,
  checkLabel,
  onPress,
}: GroceryRowProps) {
  const highlight = useRowHighlight(true, !onPress);
  return (
    // biome-ignore lint/a11y/useSemanticElements: rows sit inside SwipeActions wrappers, so a native li would not be a direct child of the list
    <div
      role="listitem"
      className={cx(
        'relative flex min-h-[60px] items-center pl-1.5 transition-opacity duration-150',
        checked && 'opacity-50',
      )}
    >
      <CheckCircle checked={checked} onCheckedChange={onCheckedChange} label={checkLabel} />
      <button
        type="button"
        onClick={onPress}
        disabled={!onPress}
        {...highlight}
        className={cx(
          'flex min-h-[60px] min-w-0 flex-1 items-center gap-3 py-3 pr-4 pl-1.5 text-left',
          'transition-[background-color] duration-150 ease-out data-pressed:bg-fill-quaternary data-pressed:transition-none',
          'outline-none focus-visible:focus-ring focus-visible:-outline-offset-2',
        )}
      >
        <CategoryTile visual={visual} size={36} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate type-body text-label-primary">{name}</span>
          {reason ? <span className="truncate type-subhead text-label-secondary">{reason}</span> : null}
        </span>
        {quantityLabel ? (
          <span className="inline-flex shrink-0 items-center rounded-xs bg-fill-tertiary px-1.5 py-0.5 type-badge text-label-secondary">
            {quantityLabel}
          </span>
        ) : null}
      </button>
      <RowSeparator inset={108} />
    </div>
  );
}
