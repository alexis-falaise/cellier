import { Euro } from 'lucide-react';
import { useMemo } from 'react';
import { goBack } from '@/app/navigation';
import { useActivePantry } from '@/app/session';
import { useProductViews } from '@/entities/product';
import { formatPriceCents, t } from '@/shared/i18n';
import {
  BackButton,
  CategoryTile,
  categoryVisual,
  EmptyState,
  hueStyle,
  LargeTitleHeader,
  ListSection,
  RowSeparator,
  useScreenScrollRef,
} from '@/shared/ui';
import { AppSyncIndicator } from '@/widgets';
import { type CategoryValue, stockValue } from '@/widgets/value/model/value';

const percent = (share: number) => Math.round(share * 100);

function CategoryValueRow({ row }: { row: CategoryValue }) {
  const visual = categoryVisual(row.category ?? {});
  const name = row.category?.name ?? t('stock.group.noCategory');
  const amount = formatPriceCents(row.cents);
  const pct = percent(row.share);
  return (
    // biome-ignore lint/a11y/useSemanticElements: rows of ListSection's role="list" container, as in ListRow
    <div
      role="listitem"
      className="relative flex min-h-[60px] items-center gap-3 px-4 py-2.5"
      aria-label={t('a11y.value.category', { category: name, amount, pct })}
    >
      <CategoryTile visual={visual} size={28} />
      <div aria-hidden="true" className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 truncate type-body text-label-primary">{name}</span>
          <span className="shrink-0 type-body tabular-nums text-label-primary">{amount}</span>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-fill-tertiary">
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.max(2, row.share * 100)}%`, backgroundColor: hueStyle(visual.hue).fg }}
            />
          </div>
          <span className="w-10 shrink-0 text-right type-caption-1 tabular-nums text-label-secondary">
            {t('value.share', { pct })}
          </span>
        </div>
      </div>
      <RowSeparator inset={56} />
    </div>
  );
}

/**
 * «Valeur du stock»: quantity × unit price of what is on the shelves, for the cellier selected on
 * Accueil (or all of them), with the distribution per category.
 */
export function ValuePage() {
  const scrollRef = useScreenScrollRef();
  const views = useProductViews();
  const { pantry, isAll } = useActivePantry();
  const pantryId = isAll ? null : (pantry?.id ?? null);
  const value = useMemo(() => stockValue(views, pantryId), [views, pantryId]);
  const scope = isAll || !pantry ? t('value.allPantries') : pantry.name;

  return (
    <main className="min-h-full bg-bg-grouped pb-(--content-bottom)">
      <LargeTitleHeader
        title={t('value.title')}
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

      {value.priced === 0 ? (
        <div className="flex flex-col items-center pt-[12vh]">
          <EmptyState icon={Euro} title={t('value.empty.title')} body={t('value.empty.body')} />
        </div>
      ) : (
        <>
          <section className="mx-4 mt-2 px-4">
            <p className="type-footnote text-label-secondary">{scope}</p>
            <p className="mt-1 type-large-title tabular-nums text-label-primary">
              {formatPriceCents(value.totalCents)}
            </p>
            <p className="mt-1 type-footnote text-label-secondary">
              {t('value.priced', { n: value.priced })}
              {value.unpriced > 0 ? ` · ${t('value.unpriced', { n: value.unpriced })}` : null}
            </p>
          </section>

          <ListSection header={t('value.byCategory')} className="mt-6">
            {value.byCategory.map((row) => (
              <CategoryValueRow key={row.category?.id ?? 'none'} row={row} />
            ))}
          </ListSection>
        </>
      )}
    </main>
  );
}
