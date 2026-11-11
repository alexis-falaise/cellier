import { Share, ShoppingBasket } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { closeSheet, openSheet, pushItem, useOverlay, useScreen } from '@/app/navigation';
import { syncNow, useActivePantry, useFirstSyncState } from '@/app/session';
import { showToast } from '@/app/toasts';
import type { Pantry } from '@/domain/types';
import { useCategories } from '@/entities/category';
import { useMembers } from '@/entities/member';
import type { GroceryItem } from '@/features/forecast';
import type { SeasonalSuggestion } from '@/features/seasonal';
import { t } from '@/shared/i18n';
import { type CellierSnapshot, useStore } from '@/shared/sync';
import {
  Button,
  type CategoryHue,
  EmptyState,
  hueStyle,
  IconButton,
  LargeTitleHeader,
  ListSection,
  PullToRefreshIndicator,
  usePullToRefresh,
  useScreenScrollRef,
} from '@/shared/ui';
import { AppSyncIndicator, SessionExpiredBanner } from '@/widgets';
import { AddGroceryRow } from '@/widgets/groceries/AddGroceryRow';
import { GroceryListRow } from '@/widgets/groceries/GroceryListRow';
import {
  addLabel,
  addProduct,
  addSeasonal,
  hide,
  putAway,
  setChecked,
  setQuantity,
} from '@/widgets/groceries/model/actions';
import { useGroceryList, useHouseholdForecasts } from '@/widgets/groceries/model/householdForecasts';
import {
  capitalize,
  groceryReasonText,
  groupByCategory,
  isThin,
  itemName,
  shareText,
  tripDateText,
  tripReasonText,
} from '@/widgets/groceries/model/presentation';
import { dismissSeasonal, undismissSeasonal, useSeasonalSuggestions } from '@/widgets/groceries/model/seasonal';
import { itemVisual } from '@/widgets/groceries/model/tripSummary';
import { NextTripCard } from '@/widgets/groceries/NextTripCard';
import { PutAwaySheet } from '@/widgets/groceries/PutAwaySheet';
import { SeasonalSection } from '@/widgets/groceries/SeasonalSection';
import { HomeSection, SkeletonList } from '@/widgets/home/HomeSections';

const selectUserId = (s: CellierSnapshot) => s.userId;

function CategoryHeader({ title, hue }: { title: string; hue: CategoryHue }) {
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ backgroundColor: hueStyle(hue).fg }} />
      <span className="min-w-0 truncate">{title}</span>
    </span>
  );
}

async function shareList(text: string): Promise<void> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ text });
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast({ message: t('toast.listCopied') });
  } catch {
    // No share sheet and no clipboard: nothing else to offer.
  }
}

/**
 * Courses (design 03 §4.8): the live list — running-low suggestions computed here plus the
 * household's manual rows — by category, then «Dans le panier». Checking never changes stock;
 * «Ranger» records the purchases. Every write is a queued mutation, so the list works offline.
 */
export function GroceriesPage() {
  const scrollRef = useScreenScrollRef();
  const noScroll = useRef<HTMLElement>(null);
  const overlay = useOverlay();
  const screen = useScreen();
  const firstSync = useFirstSyncState();
  const loading = firstSync === 'loading';
  const forecasts = useHouseholdForecasts();
  const list = useGroceryList(forecasts);
  const seasonal = useSeasonalSuggestions(list, forecasts);
  const categories = useCategories();
  const members = useMembers();
  const me = useStore(selectUserId);
  const { pantry, pantries, isAll } = useActivePantry();
  const [adding, setAdding] = useState(false);
  const pull = usePullToRefresh(scrollRef ?? noScroll, { onRefresh: () => void syncNow() });

  const { viewsById, forecastsById } = forecasts;
  const sections = useMemo(
    () => groupByCategory(list.toBuy, (id) => viewsById.get(id)?.category ?? null, categories),
    [list.toBuy, viewsById, categories],
  );
  const listed = useMemo(
    () =>
      new Set(
        [...list.toBuy, ...list.inCart].flatMap((i) => (i.kind === 'product' && !i.checked ? [i.productId] : [])),
      ),
    [list.toBuy, list.inCart],
  );
  const memberNames = useMemo(() => new Map(members.map((m) => [m.userId as string, m.displayName])), [members]);
  const memberLabel = (userId: string | null) => {
    if (userId !== null && userId === me) return t('common.you').toLocaleLowerCase('fr');
    return (userId !== null ? memberNames.get(userId) : undefined) ?? t('activity.row.formerMember');
  };

  const dateText = tripDateText(list.trip, forecasts.now);
  const brandNew = !loading && forecasts.views.length === 0 && list.toBuy.length === 0 && list.inCart.length === 0;
  const empty = !loading && list.toBuy.length === 0 && list.inCart.length === 0;

  // Put-away target: the current cellier, or the only one; otherwise the sheet asks.
  const directPantry: Pantry | null = !isAll && pantry ? pantry : pantries.length === 1 ? (pantries[0] ?? null) : null;
  const confirmPutAway = (target: Pantry) => putAway(list.inCart, target.id, target.name);

  const renderRow = (item: GroceryItem) => {
    const productId = item.kind === 'product' ? item.productId : null;
    return (
      <GroceryListRow
        key={item.key}
        name={itemName(item)}
        reason={groceryReasonText(
          item,
          productId ? forecastsById.get(productId) : undefined,
          memberLabel(item.addedBy),
          forecasts.now,
        )}
        visual={itemVisual(item, viewsById)}
        quantity={item.quantity ?? 1}
        checked={item.checked}
        onCheckedChange={(checked) => setChecked(item, checked)}
        onQuantityChange={(n) => setQuantity(item, n)}
        onHide={() => hide(item)}
        onOpen={productId ? () => pushItem(productId) : undefined}
      />
    );
  };

  const addSeasonalSuggestion = (s: SeasonalSuggestion) => {
    const replaced = s.replaces ? (list.toBuy.find((i) => i.key === s.replaces?.ref) ?? null) : null;
    addSeasonal(s, replaced);
  };
  const hideSeasonal = (s: SeasonalSuggestion) => {
    dismissSeasonal(seasonal.month, s.slug);
    showToast({
      message: t('toast.seasonalHidden'),
      action: { label: t('common.undo'), onPress: () => undismissSeasonal(seasonal.month, s.slug) },
    });
  };
  const seasonalSection = (
    <SeasonalSection
      month={seasonal.month}
      suggestions={seasonal.suggestions}
      viewsById={viewsById}
      onAdd={addSeasonalSuggestion}
      onHide={hideSeasonal}
    />
  );

  const addRow = (
    <AddGroceryRow
      products={forecasts.views}
      listed={listed}
      onAddProduct={addProduct}
      onAddLabel={addLabel}
      open={adding}
      onOpenChange={setAdding}
    />
  );

  return (
    <main className="relative min-h-full bg-bg-grouped pb-(--content-bottom)">
      <PullToRefreshIndicator pull={pull} />
      <LargeTitleHeader
        title={t('groceries.title')}
        scrollRef={scrollRef}
        trailing={
          <IconButton
            icon={Share}
            label={t('a11y.groceries.share')}
            disabled={list.toBuy.length === 0}
            onClick={() => void shareList(shareText(dateText, sections))}
          />
        }
        subtitle={<AppSyncIndicator />}
      />
      <SessionExpiredBanner />

      {brandNew ? null : (
        <div className="mt-4">
          <NextTripCard
            loading={loading}
            dateText={capitalize(dateText)}
            reasonText={tripReasonText(list.trip, forecasts.forecasts)}
          />
        </div>
      )}

      {loading ? (
        <div className="mt-6">
          <SkeletonList count={4} />
        </div>
      ) : empty ? (
        <div className="flex flex-col gap-6 pt-[10vh]">
          <EmptyState
            icon={ShoppingBasket}
            title={brandNew ? t('groceries.new.title') : t('groceries.empty.title')}
            body={brandNew ? t('groceries.new.body') : t('groceries.empty.body')}
            animateIn
            action={adding ? undefined : { label: t('groceries.add'), onPress: () => setAdding(true) }}
          />
          {adding ? addRow : null}
          {brandNew ? null : seasonalSection}
        </div>
      ) : (
        <>
          {sections.map((section) => (
            <ListSection
              key={section.key}
              className="mt-6"
              header={<CategoryHeader title={section.title} hue={section.hue} />}
            >
              {section.items.map(renderRow)}
            </ListSection>
          ))}
          <div className="mt-6">{addRow}</div>
          {seasonalSection}

          {list.inCart.length > 0 ? (
            <HomeSection title={t('groceries.inCart', { n: list.inCart.length })}>
              <ListSection label={t('groceries.inCart', { n: list.inCart.length })}>
                {list.inCart.map(renderRow)}
              </ListSection>
              <div className="mx-4 mt-3">
                <Button
                  fullWidth
                  size="large"
                  onClick={() => {
                    if (directPantry) confirmPutAway(directPantry);
                    else openSheet({ sheet: 'put-away' });
                  }}
                >
                  {directPantry
                    ? t('groceries.putAway', { pantry: directPantry.name })
                    : t('groceries.putAwayMulti', { n: list.inCart.length })}
                </Button>
              </div>
            </HomeSection>
          ) : null}

          {isThin(list.trip) ? (
            <p className="mx-8 mt-6 type-footnote text-label-secondary">{t('groceries.thinFooter')}</p>
          ) : null}
        </>
      )}

      <PutAwaySheet
        open={overlay.sheet === 'put-away' && (screen?.active ?? true)}
        onClose={closeSheet}
        pantries={pantries}
        initialPantryId={pantry?.id ?? null}
        onConfirm={(target) => {
          confirmPutAway(target);
          closeSheet();
        }}
      />
    </main>
  );
}
