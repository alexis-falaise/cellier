import { useVirtualizer } from '@tanstack/react-virtual';
import { History } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { goBack, useScreen } from '@/app/navigation';
import type { FieldOverwrite } from '@/domain/types';
import { useProductView } from '@/entities/product';
import { formatShortDate, t } from '@/shared/i18n';
import { BackButton, cx, EmptyState, LargeTitleHeader, useScreenScrollRef } from '@/shared/ui';
import { AppSyncIndicator, SessionExpiredBanner } from '@/widgets';
import { useNow } from '@/widgets/groceries/model/useNow';
import { groupByDay, type HistoryEntry } from './model/history';
import { HistoryRow } from './ui/HistoryRow';
import { entryMeta, restoreOverwrite, useProductHistory } from './useHistory';

const HEADER_ESTIMATE = 48;
const ROW_ESTIMATE = 68;

type Item =
  | { type: 'header'; key: string; label: string }
  | { type: 'row'; key: string; entry: HistoryEntry; first: boolean; last: boolean };

function dayLabel(day: number, now: number): string {
  const today = new Date(now);
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (day === startToday) return t('history.day.today');
  if (day === new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1).getTime()) {
    return t('history.day.yesterday');
  }
  const text = formatShortDate(new Date(day));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function restoreHandler(overwrite: FieldOverwrite | null): (() => void) | undefined {
  return overwrite ? () => restoreOverwrite(overwrite) : undefined;
}

/** «Historique» (design 03 §4.6.8): every entry of one product, grouped by day, virtualised. */
export function ItemHistoryPage() {
  'use no memo'; // TanStack Virtual returns a mutable instance the compiler must not memoise.
  const screen = useScreen();
  const productId = screen?.entry.productId ?? '';
  const scrollRef = useScreenScrollRef();
  const view = useProductView(productId);
  const { entries, meta } = useProductHistory(productId);
  const now = useNow();

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    for (const day of groupByDay(entries, now)) {
      out.push({ type: 'header', key: day.key, label: dayLabel(day.day, now) });
      day.entries.forEach((entry, i) => {
        out.push({ type: 'row', key: entry.key, entry, first: i === 0, last: i === day.entries.length - 1 });
      });
    }
    return out;
  }, [entries, now]);

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
  const nowDate = new Date(now);
  const previousTitle = view?.product.name ?? t('common.back');

  return (
    <main className="min-h-full bg-bg-grouped pb-(--content-bottom)">
      <LargeTitleHeader
        title={t('item.history.title')}
        scrollRef={scrollRef}
        leading={
          <BackButton
            previousTitle={previousTitle}
            fallbackLabel={t('common.back')}
            accessibleLabel={t('a11y.home.backTo', { title: previousTitle })}
            onPress={goBack}
          />
        }
        subtitle={<AppSyncIndicator />}
      />
      <SessionExpiredBanner />
      {items.length === 0 ? (
        <div className="pt-[18vh]">
          <EmptyState icon={History} title={t('item.history.title')} />
        </div>
      ) : (
        // biome-ignore lint/a11y/useSemanticElements: a virtual list of absolutely positioned rows
        <div
          ref={listRef}
          role="list"
          aria-label={t('item.history.title')}
          className="relative"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((v) => {
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
                {item.type === 'header' ? (
                  // biome-ignore lint/a11y/useSemanticElements: rows of a virtual list
                  <div role="listitem">
                    <h2 className="px-8 pt-6 pb-2 type-headline text-label-primary">{item.label}</h2>
                  </div>
                ) : (
                  <div
                    className={cx(
                      'mx-4 border-x border-edge bg-surface',
                      item.first && 'rounded-t-md border-t',
                      item.last && 'rounded-b-md border-b [&_[data-separator]]:hidden',
                    )}
                  >
                    <HistoryRow
                      entry={item.entry}
                      meta={entryMeta(item.entry, meta, nowDate)}
                      onRestore={restoreHandler(item.entry.overwrite)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
