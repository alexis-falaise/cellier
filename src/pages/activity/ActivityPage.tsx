import { useVirtualizer } from '@tanstack/react-virtual';
import { RotateCcwClock } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { goBack, pushItem, useScreen } from '@/app/navigation';
import { formatTime, t } from '@/shared/i18n';
import { syncActions } from '@/shared/sync';
import { BackButton, cx, EmptyState, LargeTitleHeader, useScreenScrollRef } from '@/shared/ui';
import { AppSyncIndicator } from '@/widgets';
import { ActivityRow } from '@/widgets/activity/ActivityRow';
import { FEED_PAGE_DAYS, type FeedItem, feedWindow, groupByDay } from '@/widgets/activity/model/feed';
import { useActivityFeed } from '@/widgets/activity/useActivityFeed';
import { useNow } from '@/widgets/groceries/model/useNow';

const HEADER_ESTIMATE = 48;
const ROW_ESTIMATE = 60;

/**
 * Activité (design 03 §4.3): the household's movements by day, newest first, virtualised, 50 days at
 * a time. Scan and put-away sessions are one row that expands. Local notes (clamped withdrawals…)
 * are marked read once the page has been shown; their rows keep a dot for this visit.
 */
export function ActivityPage() {
  'use no memo'; // TanStack Virtual returns a mutable instance the compiler must not memoise.
  const scrollRef = useScreenScrollRef();
  const screen = useScreen();
  const active = screen?.active ?? true;
  const feed = useActivityFeed();
  const now = useNow();
  const [days, setDays] = useState(FEED_PAGE_DAYS);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [highlighted, setHighlighted] = useState<ReadonlySet<string>>(() => feed.unreadMovementIds);

  const windowed = useMemo(() => feedWindow(feed.rows, now, days), [feed.rows, now, days]);
  const items = useMemo(() => groupByDay(windowed.rows, now), [windowed.rows, now]);

  // Mark local notes read while the page is on screen; keep their dots until the page closes.
  const { unreadNoteIds, unreadMovementIds } = feed;
  useEffect(() => {
    if (!active || unreadNoteIds.length === 0) return;
    setHighlighted((prev) => new Set([...prev, ...unreadMovementIds]));
    void syncActions.markActivityRead([...unreadNoteIds]).catch(() => {});
  }, [active, unreadNoteIds, unreadMovementIds]);

  const listRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => {
    const top = listRef.current?.offsetTop ?? 0;
    if (top !== scrollMargin) setScrollMargin(top);
  });

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef?.current ?? null,
    estimateSize: (i) => (items[i]?.type === 'header' ? HEADER_ESTIMATE : ROW_ESTIMATE),
    getItemKey: (i) => items[i]?.key ?? i,
    overscan: 8,
    scrollMargin,
  });
  const virtualItems = virtualizer.getVirtualItems();

  const lastIndex = virtualItems.at(-1)?.index ?? -1;
  useEffect(() => {
    if (windowed.hasMore && lastIndex >= items.length - 1) setDays((d) => d + FEED_PAGE_DAYS);
  }, [windowed.hasMore, lastIndex, items.length]);

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const renderItem = (item: FeedItem) => {
    if (item.type === 'header') {
      return (
        // biome-ignore lint/a11y/useSemanticElements: absolutely positioned rows of a virtual list
        <div role="listitem">
          <h2 className="px-8 pt-6 pb-2 type-headline text-label-primary">{item.label}</h2>
        </div>
      );
    }
    const { row } = item;
    return (
      <ActivityRow
        row={row}
        member={feed.memberLabel(row.actorId)}
        time={formatTime(new Date(row.at))}
        unread={row.movementIds.some((id) => highlighted.has(id))}
        expanded={expanded.has(row.key)}
        onToggle={() => toggle(row.key)}
        onOpenProduct={(productId) => pushItem(productId)}
        className={cx(
          'mx-4 border-x border-edge bg-surface',
          item.first && 'rounded-t-md border-t',
          item.last && 'rounded-b-md border-b [&>[data-separator]]:hidden',
        )}
      />
    );
  };

  return (
    <main className="min-h-full bg-bg-grouped pb-(--content-bottom)">
      <LargeTitleHeader
        title={t('activity.title')}
        scrollRef={scrollRef}
        leading={
          <BackButton
            previousTitle={t('tabs.home')}
            fallbackLabel={t('common.back')}
            accessibleLabel={t('a11y.home.backTo', { title: t('tabs.home') })}
            onPress={goBack}
          />
        }
        subtitle={<AppSyncIndicator />}
      />
      {items.length === 0 ? (
        <div className="pt-[18vh]">
          <EmptyState icon={RotateCcwClock} title={t('activity.empty.title')} body={t('activity.empty.body')} />
        </div>
      ) : (
        // biome-ignore lint/a11y/useSemanticElements: a virtual list of absolutely positioned rows
        <div
          ref={listRef}
          role="list"
          aria-label={t('activity.title')}
          className="relative"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualItems.map((v) => {
            const item = items[v.index];
            if (!item) return null;
            return (
              <div
                key={v.key}
                ref={virtualizer.measureElement}
                data-index={v.index}
                role="presentation"
                className="absolute inset-x-0 top-0"
                style={{ transform: `translateY(${v.start - scrollMargin}px)` }}
              >
                {renderItem(item)}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
