import { useVirtualizer } from '@tanstack/react-virtual';
import { animate, m, useMotionValue, useReducedMotion } from 'motion/react';
import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { presets } from '@/shared/lib/motion';
import { cx } from '@/shared/ui';
import type { StockItem, StockItemRow, StockRow } from './model/stockList';

/** Visible rows that may move together before the change is applied instantly (02 §4.2 step 7). */
const MAX_ANIMATED_ROWS = 20;
const SCROLL_QUIET_MS = 150;

export interface StockListProps<T extends StockItem> {
  rows: readonly StockRow<T>[];
  scrollRef: RefObject<HTMLElement | null>;
  /**
   * Identifies the user's view (scope, search, sort, group). When it changes the list re-renders on
   * the next frame without motion (02 §1.7); data changes under the same view play the FLIP.
   */
  viewKey: string;
  renderItem: (row: StockItemRow<T>) => ReactNode;
  label: string;
}

/**
 * Stock rows under TanStack Virtual (02 §4.2): rows are absolutely positioned through a per-row
 * motion value, so a data change that moves visible rows (a quantity group change, a new item)
 * springs them to their new slot with `smooth`; sorts, searches and scrolls apply instantly.
 */
export function StockList<T extends StockItem>({ rows, scrollRef, viewKey, renderItem, label }: StockListProps<T>) {
  const reduced = useReducedMotion();
  const listRef = useRef<HTMLDivElement>(null);
  const [margin, setMargin] = useState(0);
  const lastScroll = useRef(0);
  const previous = useRef<{ viewKey: string; starts: Map<string, number> }>({ viewKey, starts: new Map() });

  // Offset of the list inside the scroll container (the header above it can change height).
  useLayoutEffect(() => {
    const list = listRef.current;
    const scroller = scrollRef.current;
    if (!list || !scroller) return;
    const next = list.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    if (Math.abs(next - margin) > 0.5) setMargin(next);
  });

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const onScroll = () => {
      lastScroll.current = performance.now();
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, [scrollRef]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (rows[i]?.kind === 'header' ? (rows[i]?.first ? 40 : 56) : 66),
    getItemKey: (i) => rows[i]?.key ?? i,
    overscan: 6,
    scrollMargin: margin,
  });

  const items = virtualizer.getVirtualItems();

  // Decide once per render whether moved rows animate (02 §4.2 steps 3 and 7).
  const prev = previous.current;
  let moved = 0;
  for (const v of items) {
    const before = prev.starts.get(String(v.key));
    if (before !== undefined && before !== v.start) moved += 1;
  }
  const animateMoves =
    !reduced &&
    prev.viewKey === viewKey &&
    moved > 0 &&
    moved <= MAX_ANIMATED_ROWS &&
    performance.now() - lastScroll.current > SCROLL_QUIET_MS;

  useEffect(() => {
    previous.current = { viewKey, starts: new Map(items.map((v) => [String(v.key), v.start])) };
  });

  return (
    // biome-ignore lint/a11y/useSemanticElements: a virtual list of absolutely positioned rows
    <div
      ref={listRef}
      role="list"
      aria-label={label}
      className="relative w-full"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {items.map((v) => {
        const row = rows[v.index];
        if (!row) return null;
        return (
          <RowFrame
            key={v.key}
            index={v.index}
            offset={v.start - margin}
            animateMove={animateMoves}
            measure={virtualizer.measureElement}
          >
            {row.kind === 'header' ? (
              <SectionTitle title={row.title} count={row.count} first={row.first} />
            ) : (
              <div
                className={cx(
                  'mx-4 overflow-hidden border-x border-edge bg-surface',
                  row.first && 'rounded-t-md border-t [--row-radius-top:calc(var(--radius-md)-1px)]',
                  row.last &&
                    'rounded-b-md border-b [--row-radius-bottom:calc(var(--radius-md)-1px)] [&_[data-separator]]:hidden',
                )}
              >
                {renderItem(row)}
              </div>
            )}
          </RowFrame>
        );
      })}
    </div>
  );
}

interface RowFrameProps {
  index: number;
  offset: number;
  animateMove: boolean;
  measure: (el: Element | null) => void;
  children: ReactNode;
}

function RowFrame({ index, offset, animateMove, measure, children }: RowFrameProps) {
  const y = useMotionValue(offset);
  useLayoutEffect(() => {
    if (y.get() === offset && !y.isAnimating()) return;
    if (animateMove) {
      animate(y, offset, presets.smooth);
    } else {
      y.stop();
      y.set(offset);
    }
  }, [offset, animateMove, y]);
  return (
    <m.div ref={measure} data-index={index} className="absolute inset-x-0 top-0" style={{ y }}>
      {children}
    </m.div>
  );
}

/** Section header: Headline + trailing count in rounded secondary (03 §4.5.1). */
function SectionTitle({ title, count, first }: { title: string; count: number | null; first: boolean }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: virtual rows are absolutely positioned divs, not li elements
    <div role="listitem">
      <h2 className={cx('flex items-baseline justify-between gap-3 px-8 pb-2', first ? 'pt-2' : 'pt-6')}>
        <span className="min-w-0 truncate type-headline text-label-primary">{title}</span>
        {count !== null ? (
          <span className="shrink-0 type-subhead text-label-secondary">
            <span className="font-rounded tabular-nums">{count}</span>
          </span>
        ) : null}
      </h2>
    </div>
  );
}
