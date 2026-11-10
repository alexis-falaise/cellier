import { ArrowLeftRight, Clock, ListChecks, type LucideIcon, Minus, Plus, Replace, Undo2 } from 'lucide-react';
import { t } from '@/shared/i18n';
import { cx, RowSeparator } from '@/shared/ui';
import type { HistoryEntry, HistoryKind } from '../model/history';

const ICONS: Record<HistoryKind, LucideIcon> = {
  add: Plus,
  withdraw: Minus,
  clamped: Minus,
  recount: ListChecks,
  move: ArrowLeftRight,
  undo: Undo2,
  overwritten: Replace,
};

export interface HistoryRowProps {
  entry: HistoryEntry;
  /** «{member} · {pantry} · {time}». */
  meta: string;
  onRestore?: (() => void) | undefined;
}

/** One movement or overwritten edit (design 03 §4.6.8, 04 `HistoryRow`). */
export function HistoryRow({ entry, meta, onRestore }: HistoryRowProps) {
  const Icon = ICONS[entry.kind];
  return (
    // biome-ignore lint/a11y/useSemanticElements: rows of an inset list rendered as divs, like ListRow
    <div role="listitem" className="relative flex min-h-[60px] items-start gap-3 px-4 py-3">
      <span
        aria-hidden="true"
        className={cx(
          'mt-px flex size-7 shrink-0 items-center justify-center rounded-[6px]',
          entry.kind === 'add'
            ? 'bg-accent-tint text-accent-fg'
            : entry.kind === 'clamped' || entry.kind === 'overwritten'
              ? 'bg-warning-tint text-warning-fg'
              : 'bg-fill-tertiary text-label-secondary',
        )}
      >
        <Icon size={17} strokeWidth={1.5} absoluteStrokeWidth />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 type-body text-label-primary">{entry.title}</span>
          {entry.trailing ? (
            <span className="shrink-0 type-body text-label-secondary">
              <span className="font-rounded tabular-nums">{entry.trailing}</span>
            </span>
          ) : null}
        </div>
        {entry.detail ? <p className="type-subhead text-label-secondary">{entry.detail}</p> : null}
        <p className="flex min-w-0 items-center gap-1 type-subhead text-label-secondary">
          {entry.pending ? (
            <>
              <Clock size={12} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" className="shrink-0" />
              <span className="shrink-0">{t('history.pending')}</span>
              <span aria-hidden="true">·</span>
            </>
          ) : null}
          <span className="truncate">{meta}</span>
        </p>
        {onRestore ? (
          <button
            type="button"
            onClick={onRestore}
            className="-ml-1 min-h-11 self-start px-1 type-subhead text-accent-fg outline-none focus-visible:focus-ring active:opacity-60"
          >
            {t('history.overwritten.restore')}
          </button>
        ) : null}
      </div>
      <RowSeparator inset={56} />
    </div>
  );
}
