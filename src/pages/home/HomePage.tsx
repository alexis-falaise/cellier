import { ScanBarcode } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { navigateTo, openScanner, openSheet, pushActivity, pushItem, pushValue } from '@/app/navigation';
import { syncNow, useActiveHousehold, useActivePantry, useFirstSyncState, useSession } from '@/app/session';
import { useMe } from '@/entities/member';
import { updateAppBadge } from '@/features/notifications';
import { primeCamera } from '@/features/scanner';
import { formatPriceCents, formatRelativeTime, t } from '@/shared/i18n';
import {
  AvatarButton,
  categoryVisual,
  EmptyState,
  LargeTitleHeader,
  ListRow,
  ListSection,
  PantrySwitcher,
  PullToRefreshIndicator,
  usePullToRefresh,
  useScreenScrollRef,
} from '@/shared/ui';
import { AppSyncIndicator, SessionExpiredBanner } from '@/widgets';
import { ActivityRow } from '@/widgets/activity/ActivityRow';
import { useActivityFeed } from '@/widgets/activity/useActivityFeed';
import { useGroceryList, useHouseholdForecasts } from '@/widgets/groceries/model/householdForecasts';
import { capitalize, tripDateText, tripReasonText } from '@/widgets/groceries/model/presentation';
import { tripSummary } from '@/widgets/groceries/model/tripSummary';
import { NextTripCard } from '@/widgets/groceries/NextTripCard';
import {
  HomeSection,
  InstallRow,
  LowList,
  type LowListRow,
  NothingLowRow,
  SkeletonList,
} from '@/widgets/home/HomeSections';
import { nextToWatch, runningLowCount, runningLowRows } from '@/widgets/home/model/runningLow';
import { stockValue } from '@/widgets/value/model/value';

const MAX_LOW_ROWS = 5;
const RECENT_ROWS = 3;

function initialsOf(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((w) => w.charAt(0))
    .join('');
}

/**
 * Accueil (design 03 §4.2): what is running out, when the next trip is likely, and what changed
 * recently. Forecasts are household-wide; the cellier switcher only filters «Bientôt épuisé».
 */
export function HomePage() {
  const scrollRef = useScreenScrollRef();
  const { pantry, pantries, isAll, selection } = useActivePantry();
  const household = useActiveHousehold();
  const { user } = useSession();
  const me = useMe();
  const firstSync = useFirstSyncState();
  const loading = firstSync === 'loading';
  const forecasts = useHouseholdForecasts();
  const list = useGroceryList(forecasts);
  const feed = useActivityFeed();
  const noScroll = useRef<HTMLElement>(null);
  const pull = usePullToRefresh(scrollRef ?? noScroll, { onRefresh: () => void syncNow() });

  const lowCount = runningLowCount(forecasts.forecasts);
  useEffect(() => {
    if (!loading) void updateAppBadge(lowCount);
  }, [lowCount, loading]);

  const pantryNames = useMemo(() => new Map(pantries.map((p) => [p.id as string, p.name])), [pantries]);
  const multiPantry = pantries.length >= 2;

  const lowRows = useMemo((): LowListRow[] => {
    const { viewsById } = forecasts;
    const onlyPantry = !isAll && pantry ? pantry.id : null;
    const rows = runningLowRows(forecasts.forecasts, forecasts.names, (id) =>
      onlyPantry === null ? true : (viewsById.get(id)?.perPantry.some((p) => p.pantryId === onlyPantry) ?? false),
    );
    return rows.map((row) => {
      const view = viewsById.get(row.productId);
      const holders = view?.perPantry.filter((p) => p.quantity > 0) ?? [];
      let secondary = t('home.low.remaining', { qty: row.totalQuantity });
      if (isAll && multiPantry && holders.length === 1 && holders[0]) {
        secondary = `${secondary} ${t('home.low.inPantry', { pantry: pantryNames.get(holders[0].pantryId) ?? '' })}`;
      }
      return { ...row, secondary, visual: categoryVisual(view?.category ?? {}) };
    });
  }, [forecasts, isAll, pantry, multiPantry, pantryNames]);

  const watch = useMemo(() => nextToWatch(forecasts.forecasts, forecasts.names), [forecasts]);
  const value = useMemo(
    () => stockValue(forecasts.views, !isAll && pantry ? pantry.id : null),
    [forecasts.views, isAll, pantry],
  );
  const summary = useMemo(() => tripSummary(list.toBuy, forecasts.viewsById), [list.toBuy, forecasts.viewsById]);
  const brandNew = !loading && forecasts.views.length === 0;
  const recent = feed.rows.slice(0, RECENT_ROWS);

  const title =
    selection === null ? (
      <span aria-hidden="true" className="block h-7 w-[120px] rounded-[6px] bg-fill-tertiary" />
    ) : (
      <PantrySwitcher
        name={isAll ? t('pantry.all') : (pantry?.name ?? '')}
        interactive={multiPantry}
        onPress={() => openSheet({ sheet: 'pantries' })}
        accessibleLabel={t('a11y.pantry.switcher', { name: isAll ? t('pantry.all') : (pantry?.name ?? '') })}
        hint={t('a11y.pantry.switcherHint')}
      />
    );

  return (
    <main className="relative min-h-full bg-bg-grouped pb-(--content-bottom)">
      <PullToRefreshIndicator pull={pull} />
      <LargeTitleHeader
        title={title}
        compactTitle={isAll ? t('pantry.all') : (pantry?.name ?? undefined)}
        scrollRef={scrollRef}
        trailing={
          <AvatarButton
            src={user?.avatarUrl ?? me?.avatarUrl ?? null}
            initials={initialsOf(user?.name ?? me?.displayName)}
            label={t('a11y.settings.open')}
            onPress={() => openSheet({ sheet: 'settings' })}
          />
        }
        subtitle={<AppSyncIndicator />}
      />
      <SessionExpiredBanner />

      {brandNew ? (
        <div className="flex flex-col items-center pt-[12vh]">
          <EmptyState
            icon={ScanBarcode}
            title={t('home.empty.title')}
            body={t('home.empty.body')}
            animateIn
            action={{
              label: t('home.empty.scan'),
              onPress: () => {
                primeCamera();
                openScanner('add');
              },
            }}
            secondaryAction={{ label: t('home.empty.manual'), onPress: () => openSheet({ sheet: 'new-item' }) }}
          />
          {household.isOwner ? (
            <button
              type="button"
              onClick={() => openSheet({ sheet: 'settings', page: 'invite' })}
              className="mt-1 min-h-11 px-2 type-body text-accent-fg outline-none focus-visible:focus-ring active:opacity-60"
            >
              {t('home.empty.invite')}
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <HomeSection title={t('home.low.title')}>
            {loading ? (
              <SkeletonList count={3} />
            ) : lowRows.length > 0 ? (
              <LowList
                rows={lowRows.slice(0, MAX_LOW_ROWS)}
                total={lowRows.length}
                onOpen={(id) => pushItem(id)}
                onSeeAll={() => navigateTo('/groceries')}
              />
            ) : (
              <NothingLowRow next={watch} />
            )}
          </HomeSection>

          <div className="mt-6">
            <NextTripCard
              loading={loading}
              dateText={capitalize(tripDateText(list.trip, forecasts.now))}
              reasonText={tripReasonText(list.trip, forecasts.forecasts)}
              summary={summary}
              onPress={() => navigateTo('/groceries')}
            />
          </div>

          {value.priced > 0 ? (
            <HomeSection title={t('value.title')}>
              <ListSection label={t('value.title')}>
                <ListRow
                  title={formatPriceCents(value.totalCents)}
                  subtitle={
                    value.unpriced > 0
                      ? `${t('value.priced', { n: value.priced })} · ${t('value.unpriced', { n: value.unpriced })}`
                      : t('value.priced', { n: value.priced })
                  }
                  onPress={pushValue}
                />
              </ListSection>
            </HomeSection>
          ) : null}

          {recent.length > 0 ? (
            <HomeSection title={t('home.recent.title')} action={{ label: t('common.seeAll'), onPress: pushActivity }}>
              <ListSection label={t('home.recent.title')}>
                {recent.map((row) => (
                  <ActivityRow
                    key={row.key}
                    row={row}
                    member={feed.memberLabel(row.actorId)}
                    time={formatRelativeTime(new Date(row.at), new Date(forecasts.now))}
                    unread={row.movementIds.some((id) => feed.unreadMovementIds.has(id))}
                    onToggle={pushActivity}
                    onOpenProduct={(id) => pushItem(id)}
                  />
                ))}
              </ListSection>
            </HomeSection>
          ) : null}
        </>
      )}

      <InstallRow />
    </main>
  );
}
