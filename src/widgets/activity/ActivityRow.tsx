import { ArrowLeftRight, ChevronRight, Clock, type LucideIcon, Minus, Pencil, Plus, Scale } from 'lucide-react';
import { m } from 'motion/react';
import { useId } from 'react';
import { t } from '@/shared/i18n';
import { usePreset } from '@/shared/lib/motion';
import { cx, RowSeparator, useRowHighlight } from '@/shared/ui';
import type { FeedIcon, FeedRow } from './model/feed';

const ICONS: Record<FeedIcon, LucideIcon> = {
  add: Plus,
  withdraw: Minus,
  move: ArrowLeftRight,
  edit: Pencil,
  adjust: Scale,
};

export interface ActivityRowProps {
  row: FeedRow;
  /** «Vous», a member's name, or «Ancien membre». */
  member: string;
  /** «14:02» under a day header, or a relative time on Accueil. */
  time: string;
  unread?: boolean | undefined;
  expanded?: boolean | undefined;
  onToggle?: (() => void) | undefined;
  /** Opens the product of a single-product row. */
  onOpenProduct?: ((productId: string) => void) | undefined;
  className?: string | undefined;
}

/**
 * One Activité entry (design 03 §4.3): 36 px stone tile with the kind's glyph, title, «{member} · {time}».
 * A session row has a disclosure chevron and expands (`smooth`) into its products and quantities.
 */
export function ActivityRow({
  row,
  member,
  time,
  unread = false,
  expanded = false,
  onToggle,
  onOpenProduct,
  className,
}: ActivityRowProps) {
  const transition = usePreset('smooth');
  const detailsId = useId();
  const session = row.details !== null;
  const onPress = session
    ? onToggle
    : row.productId && onOpenProduct
      ? () => onOpenProduct(row.productId as string)
      : undefined;
  const highlight = useRowHighlight(true, !onPress);
  const Icon = ICONS[row.icon];
  const meta = t('activity.row.meta', { member, time: row.pending ? t('history.pending') : time });

  const content = (
    <>
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-fill-tertiary text-label-secondary"
      >
        <Icon size={20} strokeWidth={1.5} absoluteStrokeWidth />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-1.5">
          {unread ? (
            <span className="size-2 shrink-0 rounded-full bg-accent">
              <span className="sr-only">{t('a11y.activity.unread')}</span>
            </span>
          ) : null}
          <span className="min-w-0 truncate type-body text-label-primary">{row.title}</span>
        </span>
        <span className="flex min-w-0 items-center gap-1 type-subhead text-label-secondary">
          {row.pending ? (
            <Clock size={12} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" className="shrink-0" />
          ) : null}
          <span className="truncate">{meta}</span>
        </span>
      </span>
      {session ? (
        <m.span
          aria-hidden="true"
          className="flex shrink-0 text-label-tertiary"
          initial={false}
          animate={{ rotate: expanded ? 90 : 0 }}
          transition={transition}
        >
          <ChevronRight size={17} strokeWidth={1.5} absoluteStrokeWidth />
        </m.span>
      ) : null}
    </>
  );

  const rowClass = cx(
    'relative flex min-h-[60px] w-full items-center gap-3 px-4 py-3 text-left',
    'transition-[background-color] duration-150 ease-out data-pressed:bg-fill-quaternary data-pressed:transition-none',
    'outline-none focus-visible:focus-ring focus-visible:-outline-offset-2',
  );

  return (
    // biome-ignore lint/a11y/useSemanticElements: rows of a virtualised inset list, not direct li elements
    <div role="listitem" className={cx('relative', className)}>
      {onPress ? (
        <button
          type="button"
          onClick={onPress}
          aria-expanded={session ? expanded : undefined}
          aria-controls={session ? detailsId : undefined}
          {...highlight}
          className={rowClass}
        >
          {content}
        </button>
      ) : (
        <div className={rowClass}>{content}</div>
      )}
      {session && expanded ? (
        <m.ul
          id={detailsId}
          className="pr-4 pb-3 pl-16"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={transition}
        >
          {row.details?.map((d) => (
            <li key={d.productId}>
              <button
                type="button"
                onClick={onOpenProduct ? () => onOpenProduct(d.productId) : undefined}
                disabled={!onOpenProduct}
                className="flex min-h-9 w-full items-center text-left type-subhead text-label-secondary outline-none focus-visible:focus-ring active:opacity-60"
              >
                <span className="truncate">
                  {row.icon === 'withdraw'
                    ? t('activity.withdraw', { product: d.name, qty: d.quantity })
                    : t('activity.add', { product: d.name, qty: d.quantity })}
                </span>
              </button>
            </li>
          ))}
        </m.ul>
      ) : null}
      <RowSeparator inset={64} />
    </div>
  );
}
