import { EyeOff } from 'lucide-react';
import { AnimatePresence, m } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { t } from '@/shared/i18n';
import { usePreset } from '@/shared/lib/motion';
import {
  CategoryTile,
  type CategoryVisual,
  CheckCircle,
  cx,
  QuantityStepper,
  RowSeparator,
  SwipeActions,
  useRowHighlight,
} from '@/shared/ui';

export interface GroceryListRowProps {
  name: string;
  reason: string;
  visual: CategoryVisual;
  quantity: number;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  onQuantityChange: (quantity: number) => void;
  onHide: () => void;
  /** Product rows open the item in the Courses stack; free-text rows have no detail. */
  onOpen?: (() => void) | undefined;
}

/**
 * One Courses row (design 03 §4.8.1): check circle · tile · name over the reason · «× n». Tapping the
 * quantity expands a stepper in place (`smooth`); tapping elsewhere collapses it and saves the value.
 * Trailing swipe «Masquer». Checked rows drop to 50 % opacity (no strike-through).
 */
export function GroceryListRow({
  name,
  reason,
  visual,
  quantity,
  checked,
  onCheckedChange,
  onQuantityChange,
  onHide,
  onOpen,
}: GroceryListRowProps) {
  const highlight = useRowHighlight(true, !onOpen);
  const transition = usePreset('smooth');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(quantity);
  const rootRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ draft, quantity, onQuantityChange });
  useEffect(() => {
    latest.current = { draft, quantity, onQuantityChange };
  });

  useEffect(() => {
    if (!editing) return;
    const commit = () => {
      const l = latest.current;
      if (l.draft !== l.quantity) l.onQuantityChange(l.draft);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      setEditing(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      commit();
    };
  }, [editing]);

  const checkLabel = t('a11y.groceries.row', { name, n: quantity });

  return (
    <SwipeActions
      trailing={[{ label: t('common.hide'), icon: EyeOff, tone: 'neutral', onAction: onHide, removesRow: true }]}
      disabled={editing}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: rows sit inside SwipeActions wrappers, so a native li would not be a direct child of the list */}
      <div
        ref={rootRef}
        role="listitem"
        className={cx(
          'relative flex min-h-14 items-center pl-1.5 transition-opacity duration-150',
          checked && 'opacity-50',
        )}
      >
        <CheckCircle checked={checked} onCheckedChange={onCheckedChange} label={checkLabel} />
        <button
          type="button"
          onClick={onOpen}
          disabled={!onOpen}
          {...highlight}
          className={cx(
            'flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2.5 pr-2 pl-1.5 text-left',
            'transition-[background-color] duration-150 ease-out data-pressed:bg-fill-quaternary data-pressed:transition-none',
            'outline-none focus-visible:focus-ring focus-visible:-outline-offset-2',
          )}
        >
          <CategoryTile visual={visual} size={36} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate type-body text-label-primary">{name}</span>
            {reason ? <span className="truncate type-subhead text-label-secondary">{reason}</span> : null}
          </span>
        </button>
        <span className="flex shrink-0 items-center pr-2">
          <AnimatePresence initial={false} mode="popLayout">
            {editing ? (
              <m.span
                key="stepper"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={transition}
                className="flex"
              >
                <QuantityStepper
                  value={draft}
                  onChange={setDraft}
                  min={1}
                  max={999}
                  label={t('a11y.groceries.quantity')}
                  decrementLabel={t('a11y.item.remove1')}
                  incrementLabel={t('a11y.item.add1')}
                  editLabel={t('a11y.groceries.editQuantity')}
                />
              </m.span>
            ) : (
              <m.button
                key="quantity"
                type="button"
                aria-label={t('a11y.groceries.quantityValue', { n: quantity })}
                aria-expanded={false}
                onClick={() => {
                  setDraft(quantity);
                  setEditing(true);
                }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={transition}
                className="flex min-h-11 min-w-11 items-center justify-end px-2 type-body text-label-primary tabular-nums outline-none focus-visible:focus-ring active:opacity-60"
              >
                <span className="font-rounded">{t('groceries.qty', { n: quantity })}</span>
              </m.button>
            )}
          </AnimatePresence>
        </span>
        <RowSeparator inset={108} />
      </div>
    </SwipeActions>
  );
}
