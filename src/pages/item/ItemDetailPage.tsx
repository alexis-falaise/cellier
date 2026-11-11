import { ArrowLeftRight, PackageX, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  closeConfirm,
  goBack,
  navigateTo,
  openConfirm,
  openSheet,
  pushItemHistory,
  type TabKey,
  useOverlay,
  useScreen,
} from '@/app/navigation';
import { useActivePantry } from '@/app/session';
import { showToast } from '@/app/toasts';
import type { FieldOverwrite, ProductView } from '@/domain/types';
import { useCategory } from '@/entities/category';
import { useProductMovements } from '@/entities/movement';
import { useProductView } from '@/entities/product';
import { factsSourceUrl, hasDisplayableFacts, ProductFactsSections, useProductFacts } from '@/features/product-facts';
import { formatPriceCents, t } from '@/shared/i18n';
import { syncActions } from '@/shared/sync';
import {
  BackButton,
  ConfirmDialog,
  categoryVisual,
  EmptyState,
  ListRow,
  ListSection,
  NavBar,
  ProductImage,
  SheetTextButton,
  StatusBanner,
  useScreenScrollRef,
} from '@/shared/ui';
import { AppSyncIndicator, SessionExpiredBanner } from '@/widgets';
import { useProductForecast } from '@/widgets/item/forecasts';
import { brandSizeLine, displayBarcode, type PlainMessageKey, productSize } from '@/widgets/item/productText';
import { tryMutate } from '@/widgets/item/stockActions';
import { forecastCard } from './model/forecastCard';
import { AlertSection } from './ui/AlertSection';
import { ForecastCard } from './ui/ForecastCard';
import { HistoryRow } from './ui/HistoryRow';
import { PropertyRow } from './ui/PropertyRow';
import { QuantityBlock } from './ui/QuantityBlock';
import { entryMeta, restoreOverwrite, useProductHistory } from './useHistory';

const DELETE_CONFIRM = 'item-delete';
const TAB_TITLES: Record<TabKey, PlainMessageKey> = {
  home: 'tabs.home',
  stock: 'tabs.stock',
  groceries: 'tabs.groceries',
};
/** Scroll offset past which the product name shows in the nav bar. */
const TITLE_AFTER = 200;

/** Shows the inline nav title once the header has scrolled away. */
function useScrolledPast(ref: ReturnType<typeof useScreenScrollRef>, offset: number): boolean {
  const [past, setPast] = useState(false);
  useEffect(() => {
    const el = ref?.current;
    if (!el) return;
    const onScroll = () => setPast(el.scrollTop > offset);
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [ref, offset]);
  return past;
}

/**
 * Item detail (design 03 §4.6): header, quantity, per-cellier steppers, forecast, alert, price,
 * properties, last history rows and actions. A product deleted elsewhere stays readable, dimmed,
 * with «Restaurer»; an unknown id shows «Article introuvable».
 */
export function ItemDetailPage() {
  const screen = useScreen();
  const productId = screen?.entry.productId ?? '';
  const tab = screen?.tab ?? 'stock';
  const scrollRef = useScreenScrollRef();
  const view = useProductView(productId);
  const scrolled = useScrolledPast(scrollRef, TITLE_AFTER);

  const back = (
    <BackButton
      previousTitle={t(TAB_TITLES[tab])}
      fallbackLabel={t('common.back')}
      accessibleLabel={t('a11y.home.backTo', { title: t(TAB_TITLES[tab]) })}
      onPress={goBack}
    />
  );

  if (!view) {
    return (
      <main className="min-h-full bg-bg-grouped pb-(--content-bottom)">
        <NavBar leading={back} scrollRef={scrollRef} />
        <EmptyState
          className="pt-[18vh]"
          icon={PackageX}
          title={t('item.notFound.title')}
          body={t('item.notFound.body')}
          action={{ label: t('item.notFound.home'), onPress: () => navigateTo('/') }}
        />
      </main>
    );
  }

  return (
    <main className="min-h-full bg-bg-grouped pb-(--content-bottom)">
      <NavBar
        title={scrolled ? view.product.name : undefined}
        leading={back}
        scrollRef={scrollRef}
        trailing={
          <div className="flex items-center gap-1">
            <AppSyncIndicator compact />
            {view.product.deletedAt === null ? (
              <SheetTextButton onPress={() => openSheet({ sheet: 'item-edit', id: view.product.id })}>
                {t('common.edit')}
              </SheetTextButton>
            ) : null}
          </div>
        }
      />
      <SessionExpiredBanner />
      <ItemDetail view={view} active={screen?.active ?? true} />
    </main>
  );
}

function ItemDetail({ view, active }: { view: ProductView; active: boolean }) {
  const { product } = view;
  const overlay = useOverlay();
  const { pantries, pantry: currentPantry } = useActivePantry();
  const { forecast, now } = useProductForecast(product.id);
  const { entries, meta } = useProductHistory(product.id);
  const movements = useProductMovements(product.id);
  const category = useCategory(product.categoryId);
  const deleted = product.deletedAt !== null;
  const [deleting, setDeleting] = useState(false);

  // After «Supprimer l’article»: wait for the confirmation entry to leave history, then pop.
  useEffect(() => {
    if (!deleting || overlay.confirm) return;
    goBack();
  }, [deleting, overlay.confirm]);

  const card = useMemo(() => forecastCard(forecast, now), [forecast, now]);
  const nowDate = new Date(now);
  const livePantryIds = new Set(pantries.map((p) => p.id as string));
  const lastPantry = movements.find((m) => livePantryIds.has(m.movement.pantryId))?.movement.pantryId ?? null;
  const fallbackPantryId = lastPantry ?? (currentPantry?.id as string | undefined) ?? pantries[0]?.id ?? null;
  const stockRows = view.perPantry.filter((r) => r.quantity > 0 || view.perPantry.length === 1);
  const rows = stockRows.length > 0 ? stockRows : view.perPantry.slice(0, 1);
  const visual = categoryVisual(category ?? {});
  const subtitle = brandSizeLine(product);
  const fromOff = product.catalogGtin !== null;
  const source = fromOff ? t('source.off') : t('source.manual');
  const factsGtin = product.catalogGtin ?? product.gtin;
  const { facts } = useProductFacts(factsGtin);
  const showFacts = facts !== null && hasDisplayableFacts(facts);
  const attribution = attributionFor(facts?.found ? facts.source : fromOff ? 'off' : null);

  const remove = () => {
    const id = tryMutate('product.delete', { productId: product.id });
    setDeleting(true);
    closeConfirm();
    if (id) {
      showToast({
        message: t('toast.itemDeleted'),
        key: `item-deleted:${product.id}`,
        action: { label: t('common.undo'), onPress: () => void syncActions.undo(id) },
      });
    }
  };

  return (
    <div className="flex flex-col gap-8 pt-2">
      {deleted ? (
        <StatusBanner
          icon={Trash2}
          tone="warning"
          text={t('toast.itemDeleted')}
          action={{
            label: t('common.restore'),
            onPress: () => tryMutate('product.restore', { productId: product.id }),
          }}
          className="mx-4"
        />
      ) : null}

      <div className={deleted ? 'pointer-events-none flex flex-col gap-8 opacity-50' : 'flex flex-col gap-8'}>
        <header className="flex flex-col items-center px-8 pt-4 text-center">
          <ProductImage src={product.imageUrl} visual={visual} size={112} />
          <h1 className="mt-4 line-clamp-3 type-title-1 text-balance text-label-primary">{product.name}</h1>
          {subtitle ? <p className="mt-1 type-subhead text-label-secondary">{subtitle}</p> : null}
        </header>

        <QuantityBlock
          productId={product.id}
          rows={rows}
          pantries={pantries}
          fallbackPantryId={fallbackPantryId}
          disabled={deleted}
        />

        <ForecastCard model={card} />

        <AlertSection product={product} forecast={forecast} disabled={deleted} />

        <ListSection header={t('item.price.title')}>
          {product.priceCents !== null ? (
            <PropertyRow
              label={t('field.unitPrice')}
              value={formatPriceCents(product.priceCents)}
              caption={product.priceSource === 'catalog' ? t('source.openPricesShort') : t('source.manual')}
              numeric
              missing={t('common.none')}
            />
          ) : (
            <ListRow
              variant="plain"
              title={<span className="text-label-secondary">{t('item.price.unknown')}</span>}
              trailing={
                <SheetTextButton onPress={() => openSheet({ sheet: 'item-edit', id: product.id })}>
                  {t('common.add')}
                </SheetTextButton>
              }
            />
          )}
        </ListSection>

        <ListSection header={t('item.info.title')}>
          <PropertyRow
            label={t('field.category')}
            value={category?.name ?? null}
            caption={source}
            missing={t('common.none')}
          />
          <PropertyRow
            label={t('field.size')}
            value={productSize(product)}
            caption={source}
            missing={t('common.none')}
          />
          <PropertyRow label={t('field.brand')} value={product.brand} caption={source} missing={t('common.none')} />
          <PropertyRow
            label={t('field.barcode')}
            value={product.gtin ? displayBarcode(product.gtin) : null}
            numeric
            missing={t('common.none')}
          />
        </ListSection>

        {showFacts && facts ? <ProductFactsSections facts={facts} netUnit={product.netUnit} /> : null}

        {entries.length > 0 ? (
          <ListSection header={t('item.history.title')}>
            {entries.slice(0, 5).map((entry) => (
              <HistoryRow
                key={entry.key}
                entry={entry}
                meta={entryMeta(entry, meta, nowDate)}
                onRestore={restoreHandler(entry.overwrite)}
              />
            ))}
            <ListRow variant="navigation" title={t('item.history.all')} onPress={() => pushItemHistory(product.id)} />
          </ListSection>
        ) : null}

        <ListSection label={t('item.info.title')}>
          {pantries.length >= 2 && view.totalQuantity > 0 ? (
            <ListRow
              variant="button"
              icon={ArrowLeftRight}
              title={t('item.move')}
              onPress={() => openSheet({ sheet: 'item-move', id: product.id })}
            />
          ) : null}
          <ListRow variant="destructive" title={t('item.delete')} onPress={() => openConfirm(DELETE_CONFIRM)} />
        </ListSection>
      </div>

      {attribution && factsGtin ? (
        <p className="px-8 text-center type-footnote text-label-secondary">
          {t(attribution.text)}
          <br />
          <a
            href={factsSourceUrl(attribution.source, factsGtin)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center text-accent-fg outline-none focus-visible:focus-ring"
          >
            {t(attribution.link)}
          </a>
        </p>
      ) : null}

      <ConfirmDialog
        open={active && overlay.confirm === DELETE_CONFIRM && !deleting}
        onOpenChange={(open) => {
          if (!open) closeConfirm();
        }}
        title={t('item.delete.title', { product: product.name })}
        message={t('item.delete.message', { n: view.totalQuantity })}
        actions={[{ label: t('item.delete'), destructive: true, onPress: remove }]}
        cancelLabel={t('common.cancel')}
      />
    </div>
  );
}

type FactsSourceKey = 'off' | 'obf' | 'opf' | 'opff';

/** Open Food Facts family attribution (ODbL) for the database that holds the product. */
function attributionFor(
  source: FactsSourceKey | null,
): { source: FactsSourceKey; text: PlainMessageKey; link: PlainMessageKey } | null {
  if (source === null) return null;
  if (source === 'off') return { source, text: 'item.attribution.off', link: 'item.attribution.link' };
  return { source, text: `facts.attribution.${source}`, link: `facts.attribution.link.${source}` };
}

function restoreHandler(overwrite: FieldOverwrite | null): (() => void) | undefined {
  return overwrite ? () => restoreOverwrite(overwrite) : undefined;
}
