import { ChevronRight } from 'lucide-react';
import { m } from 'motion/react';
import { t } from '@/shared/i18n';
import { CategoryTile, type CategoryVisual, cx, usePress } from '@/shared/ui';

export interface NextTripSummary {
  count: number;
  /** Category tiles of the first rows (up to 4). */
  visuals: readonly CategoryVisual[];
  /** «Lait, Café, Pâtes et 2 autres». */
  preview: string;
}

export interface NextTripCardProps {
  /** «Samedi 16 nov.», «Vers samedi 16 nov.», «Cette semaine»… */
  dateText: string;
  reasonText: string;
  /** Accueil: tiles, count and preview; null when nothing is planned (`trip.empty`). Omit for the Courses header. */
  summary?: NextTripSummary | null | undefined;
  /** Accueil: the whole card opens Courses. */
  onPress?: (() => void) | undefined;
  /** First sync: bars instead of text. */
  loading?: boolean | undefined;
  className?: string | undefined;
}

function SummaryRow({ summary }: { summary: NextTripSummary | null }) {
  if (!summary) return <p className="mt-3 type-subhead text-label-secondary">{t('trip.empty')}</p>;
  return (
    <>
      <span className="mt-3 flex items-center gap-2">
        <span className="flex shrink-0 items-center" aria-hidden="true">
          {summary.visuals.map((visual, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: a fixed, ordered set of at most four tiles
              key={i}
              className={cx('relative rounded-[6px] ring-2 ring-surface', i > 0 && '-ml-1.5')}
              style={{ zIndex: summary.visuals.length - i }}
            >
              <CategoryTile visual={visual} size={28} />
            </span>
          ))}
        </span>
        <span className="min-w-0 flex-1 truncate type-subhead text-label-primary">
          {t('trip.count', { n: summary.count })}
        </span>
        <ChevronRight
          size={17}
          strokeWidth={1.5}
          absoluteStrokeWidth
          aria-hidden="true"
          className="shrink-0 text-label-tertiary"
        />
      </span>
      <span className="mt-1 block truncate type-footnote text-label-secondary">{summary.preview}</span>
    </>
  );
}

/**
 * «Prochaines courses» (design 03 §4.2.4): label, likely date, why, then on Accueil what is on the list.
 * On Accueil the whole card opens Courses with the `press` scale (0.97); on Courses it is a plain header.
 */
export function NextTripCard({
  dateText,
  reasonText,
  summary,
  onPress,
  loading = false,
  className,
}: NextTripCardProps) {
  const { scale, handlers } = usePress(0.97, !onPress || loading);
  const body = loading ? (
    <span aria-hidden="true" className="flex flex-col gap-2 pt-1">
      <span className="h-3 w-1/4 rounded-xs bg-fill-quaternary" />
      <span className="h-5 w-3/5 rounded-xs bg-fill-tertiary" />
      <span className="h-3.5 w-[35%] rounded-xs bg-fill-quaternary" />
    </span>
  ) : (
    <>
      <span className="block type-footnote text-label-secondary">{t('trip.label')}</span>
      <span className="mt-0.5 block type-title-2">{dateText}</span>
      <span className="mt-1 block type-subhead text-pretty text-label-secondary">{reasonText}</span>
      {summary !== undefined ? <SummaryRow summary={summary} /> : null}
    </>
  );
  const frame = cx('mx-4 block rounded-lg border border-edge bg-surface p-4 text-left', className);
  if (!onPress || loading) {
    return <section className={frame}>{body}</section>;
  }
  return (
    <m.button
      type="button"
      onClick={onPress}
      {...handlers}
      style={{ scale }}
      className={cx(frame, 'w-[calc(100%-32px)] outline-none focus-visible:focus-ring')}
    >
      {body}
    </m.button>
  );
}
