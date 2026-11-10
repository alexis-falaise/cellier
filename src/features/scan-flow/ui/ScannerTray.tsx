import { ChevronDown } from 'lucide-react';
import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';
import type { Category, PantryId } from '@/domain/types';
import { t } from '@/shared/i18n';
import { presets } from '@/shared/lib/motion';
import { cx, QuantityNumber } from '@/shared/ui';
import { type EvalContext, evaluateRow, type TrayRow as Row, type ScanMode } from '../model/tray';
import { TrayRow } from './TrayRow';

/** Tray heights (03 §4.4.2): compact = header + 2 rows, empty = header only; expanded = 60 % of the viewport. */
export const TRAY_HEADER = 56;
export const TRAY_ROW = 64;
export const TRAY_COMPACT = TRAY_HEADER + 2 * TRAY_ROW + 16;
export const TRAY_EMPTY = 96;

export interface ScannerTrayProps {
  rows: readonly Row[];
  ctx: EvalContext;
  mode: ScanMode;
  units: number;
  categories: readonly Category[];
  pantryName: (id: PantryId | null) => string;
  /** Show the pantry chip (two or more celliers). */
  showPantryChip: boolean;
  onPantryChip: () => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  /** Total panel height and the part visible in compact mode, px. */
  height: number;
  visible: number;
  doneDisabled: boolean;
  onDone: () => void;
  /** One-line banner in the header area (restored draft, removed row with «Annuler»). */
  banner: ReactNode;
  onQuantity: (rowId: string, quantity: number) => void;
  onRemove: (rowId: string) => void;
  onName: (rowId: string) => void;
  onPick: (rowId: string) => void;
  onTakeFrom: (rowId: string, pantryId: PantryId) => void;
}

/**
 * The scanned products of the session on dark material at the bottom of the cover (03 §4.4.2). Two detents moved
 * with `sheet` from the grabber (the drag between detents is not implemented: LazyMotion loads no drag feature).
 */
export function ScannerTray(props: ScannerTrayProps) {
  const { rows, ctx, mode, units, expanded, height, visible } = props;
  const reduced = useReducedMotion();
  const y = expanded ? 0 : Math.max(0, height - visible);
  const pantry = props.pantryName(ctx.pantryId);

  return (
    <m.section
      aria-label={t('scanner.tray.count', { n: units })}
      className="absolute inset-x-0 bottom-0 z-10 flex flex-col overflow-hidden rounded-t-xl bg-scanner-material text-stone-0 backdrop-blur-xl"
      style={{ height }}
      initial={false}
      animate={{ y, transition: reduced ? presets.reduced : presets.sheet }}
    >
      <button
        type="button"
        onClick={props.onToggleExpanded}
        aria-label={expanded ? t('a11y.scanner.trayCollapse') : t('a11y.scanner.trayExpand')}
        aria-expanded={expanded}
        className="flex h-5 shrink-0 items-start justify-center pt-1.5 outline-none focus-visible:focus-ring"
      >
        <span aria-hidden="true" className="h-[5px] w-9 rounded-full bg-stone-0/40" />
      </button>
      <div className="flex h-11 shrink-0 items-center gap-3 px-4">
        {props.showPantryChip ? (
          <button
            type="button"
            onClick={props.onPantryChip}
            className="flex h-8 min-w-0 items-center gap-1 rounded-full bg-stone-0/15 px-3 type-subhead text-stone-0 outline-none focus-visible:focus-ring active:opacity-60"
          >
            <span className="truncate">
              {mode === 'add' ? t('scanner.tray.to', { pantry }) : t('scanner.tray.from', { pantry })}
            </span>
            <ChevronDown size={16} strokeWidth={2} aria-hidden="true" className="shrink-0" />
          </button>
        ) : null}
        <p className="min-w-0 flex-1 truncate type-subhead text-stone-0/70" aria-live="off">
          <QuantityNumber
            value={units}
            size="badge"
            className="text-stone-0/70"
            format={() => t('scanner.tray.count', { n: units })}
          />
        </p>
        <button
          type="button"
          onClick={props.onDone}
          disabled={props.doneDisabled}
          className={cx(
            'h-9 shrink-0 rounded-full px-4 type-subhead font-semibold outline-none focus-visible:focus-ring',
            props.doneDisabled ? 'bg-stone-0/20 text-stone-0/50' : 'bg-accent text-on-accent active:opacity-80',
          )}
        >
          {t('scanner.tray.done')}
        </button>
      </div>
      <div className="min-h-0 shrink-0">{props.banner}</div>
      {rows.length === 0 ? (
        <p className="px-4 pt-2 type-footnote text-stone-0/60">{t('scanner.tray.empty')}</p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[calc(var(--safe-bottom)+8px)]">
          <AnimatePresence initial={false}>
            {rows.map((row) => (
              <TrayRow
                key={row.id}
                row={row}
                view={evaluateRow(row, ctx)}
                mode={mode}
                categories={props.categories}
                pantryName={props.pantryName}
                trayPantryId={ctx.pantryId}
                onQuantity={(q) => props.onQuantity(row.id, q)}
                onRemove={() => props.onRemove(row.id)}
                onName={() => props.onName(row.id)}
                onPick={() => props.onPick(row.id)}
                onTakeFrom={(p) => props.onTakeFrom(row.id, p)}
              />
            ))}
          </AnimatePresence>
        </ul>
      )}
    </m.section>
  );
}
