import { useMemo } from 'react';
import { openSheet } from '@/app/navigation';
import type { Product } from '@/domain/types';
import { useProductMovements } from '@/entities/movement';
import { type PriceStats, pricePoints, priceStats } from '@/features/prices';
import { formatPriceCents, formatShortDate, t } from '@/shared/i18n';
import { ListRow, ListSection, RowSeparator, SheetTextButton } from '@/shared/ui';
import { PropertyRow } from './PropertyRow';

const HISTORY_ROWS = 6;

function typicalLabel(stats: PriceStats): string {
  if (stats.measure === 'median') return t('price.typical.median');
  if (stats.measure === 'mean') return t('price.typical.mean');
  return t('price.typical.single');
}

function sourceCaption(product: Product): string {
  if (product.priceSource === 'catalog') return t('source.openPricesShort');
  if (product.priceSource === 'receipt') return t('source.receipt');
  return t('source.manual');
}

/**
 * Item detail «Prix»: with purchases, the typical price (median or average, whichever describes the
 * purchases better — see features/prices), the latest price paid, the range and the last purchases.
 * Without any, the product's price as before (catalogue or typed in).
 */
export function PriceSection({ product }: { product: Product }) {
  const movements = useProductMovements(product.id);
  const points = useMemo(
    () =>
      pricePoints(
        movements.map((v) => v.movement),
        product.id,
      ),
    [movements, product.id],
  );
  const stats = useMemo(() => priceStats(points), [points]);

  if (!stats) {
    return (
      <ListSection header={t('item.price.title')}>
        {product.priceCents !== null ? (
          <PropertyRow
            label={t('field.unitPrice')}
            value={formatPriceCents(product.priceCents)}
            caption={sourceCaption(product)}
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
    );
  }

  const other =
    stats.measure === 'median'
      ? t('price.otherMeasure.mean', { price: formatPriceCents(stats.meanCents) })
      : stats.measure === 'mean' && stats.meanCents !== stats.medianCents
        ? t('price.otherMeasure.median', { price: formatPriceCents(stats.medianCents) })
        : null;
  const recent = [...points].reverse().slice(0, HISTORY_ROWS);

  return (
    <>
      <ListSection
        header={t('item.price.title')}
        footer={stats.measure === 'median' ? t('price.median.why') : undefined}
      >
        <PropertyRow
          label={typicalLabel(stats)}
          value={formatPriceCents(stats.typicalCents)}
          caption={[t('price.typical.caption', { n: stats.count }), other].filter(Boolean).join(' · ')}
          numeric
          missing={t('common.none')}
        />
        {stats.count > 1 ? (
          <PropertyRow
            label={t('price.latest')}
            value={formatPriceCents(stats.latest.priceCents)}
            caption={formatShortDate(new Date(stats.latest.at))}
            numeric
            missing={t('common.none')}
          />
        ) : null}
        {stats.count > 1 && stats.minCents !== stats.maxCents ? (
          <PropertyRow
            label={t('price.range')}
            value={t('price.rangeValue', {
              min: formatPriceCents(stats.minCents),
              max: formatPriceCents(stats.maxCents),
            })}
            numeric
            missing={t('common.none')}
          />
        ) : null}
      </ListSection>

      {stats.count > 1 ? (
        <ListSection header={t('price.history')}>
          {recent.map((p) => {
            const date = formatShortDate(new Date(p.at));
            return (
              // biome-ignore lint/a11y/useSemanticElements: rows of an inset list rendered as divs, like ListRow
              <div key={p.movementId} role="listitem" className="relative flex min-h-11 items-center gap-3 px-4 py-2.5">
                <span className="min-w-0 flex-1 truncate type-subhead text-label-secondary">
                  {p.store ? t('price.history.row', { date, store: p.store }) : t('price.history.rowNoStore', { date })}
                </span>
                <span className="shrink-0 font-rounded type-body tabular-nums text-label-primary">
                  {formatPriceCents(p.priceCents)}
                </span>
                <RowSeparator inset={16} />
              </div>
            );
          })}
        </ListSection>
      ) : null}
    </>
  );
}
