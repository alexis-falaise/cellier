import { ArrowUpDown, Package, Plus, Search } from 'lucide-react';
import { memo, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { openScanner, openSheet, pushItem, useOverlay, useScreen } from '@/app/navigation';
import { parseStockSearch } from '@/app/search';
import { syncNow, useActivePantry, useFirstSyncState } from '@/app/session';
import { usePantryStock } from '@/entities/pantry';
import { useProductViews } from '@/entities/product';
import { setNewItemPrefill } from '@/features/item-edit/prefill';
import { primeCamera } from '@/features/scanner';
import { t } from '@/shared/i18n';
import { useStore } from '@/shared/sync';
import {
  EmptyState,
  IconButton,
  ItemRow,
  LargeTitleHeader,
  PantrySwitcher,
  PullToRefreshIndicator,
  SearchField,
  SkeletonRow,
  type SwipeAction,
  SwipeActions,
  usePullToRefresh,
  useScreenScrollRef,
} from '@/shared/ui';
import { AppSyncIndicator, SessionExpiredBanner } from '@/widgets';
import { useForecastMap } from '@/widgets/item/forecasts';
import { pantryNameMap } from '@/widgets/item/productText';
import { changeStock } from '@/widgets/item/stockActions';
import { buildStockEntries, type EntryCache, type StockEntry } from './model/entries';
import { createStockSearch } from './model/search';
import { selectStockSearchDocs } from './model/selectors';
import { buildStockRows, type GroupLabels } from './model/stockList';
import { useStockUrl } from './model/stockUrl';
import { resolveStockView, useStoredStockView } from './model/viewPrefs';
import { StockList } from './StockList';
import { StockViewSheet } from './StockViewSheet';

const SEARCH_URL_DELAY_MS = 300;

/** Entries keep their object while unchanged (one Stock page exists). */
let entryCache: EntryCache = new Map();

function groupLabels(): GroupLabels {
  return {
    noCategory: t('stock.group.noCategory'),
    added: {
      today: t('stock.group.added.today'),
      week: t('stock.group.added.week'),
      month: t('stock.group.added.month'),
      older: t('stock.group.added.older'),
    },
    price: {
      lt2: t('stock.group.price.lt2'),
      from2to5: t('stock.group.price.2to5'),
      from5to10: t('stock.group.price.5to10'),
      gt10: t('stock.group.price.gt10'),
      unknown: t('stock.group.price.unknown'),
    },
    quantity: {
      zero: t('stock.group.qty.zero'),
      one: t('stock.group.qty.one'),
      from2to5: t('stock.group.qty.2to5'),
      from6to11: t('stock.group.qty.6to11'),
      from12: t('stock.group.qty.12plus'),
    },
  };
}

const LABELS = groupLabels();

function addOne(entry: StockEntry) {
  if (entry.targetPantryId) changeStock(entry.targetPantryId, entry.id, 1, entry.targetQuantity, 'swipe');
}

function removeOne(entry: StockEntry) {
  if (entry.targetPantryId) changeStock(entry.targetPantryId, entry.id, -1, entry.targetQuantity, 'swipe');
}

function openNewItem(name?: string) {
  setNewItemPrefill(name ?? '');
  openSheet({ sheet: 'new-item' });
}

/**
 * Stock (design 03 §4.5): the inventory of the current cellier or of all celliers, searchable,
 * sorted and grouped, virtualised, with +1 / −1 swipes and pull to refresh.
 */
export function StockPage() {
  const screen = useScreen();
  const fallbackRef = useRef<HTMLDivElement>(null);
  const scrollRef = useScreenScrollRef() ?? fallbackRef;
  const active = screen?.active ?? false;
  const url = parseStockSearch(screen?.search ?? {});
  const stored = useStoredStockView();
  const view = resolveStockView(url, stored);
  const writeUrl = useStockUrl();
  const overlay = useOverlay();
  const pantry = useActivePantry();
  const firstSync = useFirstSyncState();

  // Search: the field drives the results at once; the URL follows after a pause.
  const urlQuery = url.q ?? '';
  const [query, setQuery] = useState(urlQuery);
  const written = useRef(urlQuery);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (urlQuery !== written.current) {
      written.current = urlQuery;
      setQuery(urlQuery);
    }
  }, [urlQuery]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onQueryChange = (value: string) => {
    setQuery(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const next = value.trim() ? value.slice(0, 100) : '';
      written.current = next;
      writeUrl({ q: next || undefined });
    }, SEARCH_URL_DELAY_MS);
  };

  // Data.
  const views = useProductViews();
  const pantryId = pantry.pantry?.id ?? null;
  const pantryStock = usePantryStock(pantryId ?? '');
  const forecasts = useForecastMap();
  const pantryNames = useMemo(() => pantryNameMap(pantry.pantries), [pantry.pantries]);
  const fallbackPantryId = pantryId ?? pantry.pantries[0]?.id ?? null;
  const entries = useMemo(() => {
    const built = buildStockEntries(
      { all: pantry.isAll, pantryId: fallbackPantryId, pantryNames },
      views,
      pantryStock,
      forecasts,
      entryCache,
    );
    entryCache = built.cache;
    return built.entries;
  }, [pantry.isAll, fallbackPantryId, pantryNames, views, pantryStock, forecasts]);

  const docs = useStore(selectStockSearchDocs);
  const index = useMemo(() => createStockSearch(docs), [docs]);
  const trimmed = query.trim();
  const searchIds = useMemo(() => (trimmed ? index.search(trimmed) : null), [index, trimmed]);

  const { group, sort, dir, showEmpty } = view;
  const list = useMemo(
    () => buildStockRows(entries, { group, sort, dir, showEmpty }, LABELS, Date.now(), searchIds),
    [entries, group, sort, dir, showEmpty, searchIds],
  );
  const viewKey = `${pantry.selection ?? ''}|${group}|${sort}|${dir}|${showEmpty}|${trimmed}`;

  const pull = usePullToRefresh(scrollRef, { onRefresh: () => void syncNow(), disabled: !active });

  // Header.
  const titleText = pantry.isAll ? t('pantry.all') : (pantry.pantry?.name ?? '');
  const title = pantry.selection ? (
    <PantrySwitcher
      name={titleText}
      interactive={pantry.pantries.length >= 2}
      onPress={() => openSheet({ sheet: 'pantries' })}
      accessibleLabel={t('a11y.pantry.switcher', { name: titleText })}
      hint={t('a11y.pantry.switcherHint')}
    />
  ) : (
    <h1 className="flex">
      <span className="sr-only">{t('tabs.stock')}</span>
      <span aria-hidden="true" className="block h-7 w-[120px] rounded-[6px] bg-fill-tertiary" />
    </h1>
  );
  const placeholder = pantry.isAll
    ? t('stock.search.placeholderAll')
    : t('stock.search.placeholder', { pantry: titleText });

  const startScan = () => {
    primeCamera();
    openScanner('add');
  };

  let body: ReactNode;
  if (firstSync === 'loading' && entries.length === 0) {
    body = (
      <div aria-hidden="true" className="mx-4 overflow-hidden rounded-md border border-edge bg-surface">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    );
  } else if (entries.length === 0 && !searchIds) {
    body = (
      <EmptyState
        icon={Package}
        animateIn
        className="pt-[12vh]"
        title={pantry.isAll ? t('stock.empty.titleAll') : t('stock.empty.title', { pantry: titleText })}
        body={t('stock.empty.body')}
        action={{ label: t('home.empty.scan'), onPress: startScan }}
        secondaryAction={{ label: t('stock.empty.manual'), onPress: () => openNewItem() }}
      />
    );
  } else if (searchIds && list.rows.length === 0) {
    body = (
      <EmptyState
        icon={Search}
        className="pt-[12vh]"
        title={t('stock.noResults.title')}
        body={t('stock.noResults.body', { q: trimmed })}
        action={{ label: t('common.createNamed', { q: trimmed }), onPress: () => openNewItem(trimmed) }}
      />
    );
  } else {
    body = (
      <>
        <StockList
          rows={list.rows}
          scrollRef={scrollRef}
          viewKey={viewKey}
          label={titleText || t('tabs.stock')}
          renderItem={(row) => <StockItemView entry={row.item} />}
        />
        {list.itemCount > 0 ? (
          <p className="mt-4 px-4 text-center type-footnote text-label-secondary">
            {t('stock.footer', { n: list.itemCount, u: t('unit.count', { u: list.unitCount }) })}
          </p>
        ) : null}
      </>
    );
  }

  return (
    <div ref={fallbackRef} className="relative flex min-h-full flex-col pb-(--content-bottom)">
      <PullToRefreshIndicator pull={pull} />
      <LargeTitleHeader
        title={title}
        compactTitle={titleText}
        scrollRef={scrollRef}
        trailing={
          <>
            <IconButton
              icon={ArrowUpDown}
              label={t('a11y.stock.view')}
              onClick={() => openSheet({ sheet: 'stock-view' })}
            />
            <IconButton icon={Plus} label={t('a11y.stock.add')} onClick={() => openNewItem()} />
          </>
        }
        subtitle={<AppSyncIndicator />}
        search={
          <SearchField
            value={query}
            onChange={onQueryChange}
            placeholder={placeholder}
            cancelLabel={t('common.cancel')}
            clearLabel={t('a11y.search.clear')}
          />
        }
      />
      <SessionExpiredBanner />
      <main className="flex flex-1 flex-col pt-2">{body}</main>
      <StockViewSheet open={active && overlay.sheet === 'stock-view'} view={view} />
    </div>
  );
}

/** One Stock row: leading swipe «+1» (purchase), trailing «−1» (consume, not offered at 0). */
const StockItemView = memo(function StockItemView({ entry }: { entry: StockEntry }) {
  const leading: SwipeAction[] = entry.targetPantryId
    ? [
        {
          label: t('stock.swipe.add'),
          accessibleLabel: t('a11y.item.add1'),
          tone: 'accent',
          onAction: () => addOne(entry),
        },
      ]
    : [];
  const trailing: SwipeAction[] =
    entry.targetPantryId && entry.targetQuantity > 0
      ? [
          {
            label: t('stock.swipe.remove'),
            accessibleLabel: t('a11y.item.remove1'),
            tone: 'neutral',
            onAction: () => removeOne(entry),
          },
        ]
      : [];
  return (
    <SwipeActions leading={leading} trailing={trailing}>
      <ItemRow
        name={entry.name}
        secondary={entry.secondary}
        visual={entry.visual}
        quantity={entry.quantity}
        low={entry.low}
        accessibleLabel={entry.accessibleLabel}
        onPress={() => pushItem(entry.id, 'stock')}
      />
    </SwipeActions>
  );
});
